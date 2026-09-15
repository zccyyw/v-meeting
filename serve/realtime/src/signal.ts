import { randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import {
  ClientMessageSchema,
  type ClientMessage,
  type ServerMessage,
  type UserRole,
} from "@meeting/shared";
import type {
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
} from "mediasoup/types";
import type {
  DtlsParameters,
  RtpCapabilities,
  RtpParameters,
} from "mediasoup/types";
import { MeetingRoom } from "./room.js";
import { createRouter, createWebRtcTransport } from "./mediasoup.js";
import { nowSql, type Db } from "./db.js";
import { validateJoinToken } from "./auth-bridge.js";

type PeerMedia = {
  peerId: string;
  meetingId: string;
  userId: number | null;
  ws: WebSocket;
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  transports: Map<string, WebRtcTransport>;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
};

type RoomState = {
  room: MeetingRoom;
  router: Router;
  peers: Map<string, PeerMedia>;
  /** 被主持人强制静音的成员 key（见 mutedKey）：重连/刷新后仍保持静音 */
  mutedByHost: Set<string>;
  /** 主持人是否进过本会议：用于区分"主持人离线待重连"与"参会者早到" */
  hostJoined: boolean;
};

function peerId() {
  return randomBytes(8).toString("hex");
}

type ProducerSource = "microphone" | "camera" | "screen";

function producerSource(
  kind: "audio" | "video",
  appData: Record<string, unknown> | undefined
): ProducerSource {
  if (kind === "audio") return "microphone";
  if (appData?.source === "screen") return "screen";
  return "camera";
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** 读取"毫秒"型环境变量：非法或缺失时用默认值；显式 0 表示关闭该行为。 */
function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/**
 * 房间空置多久后自动把会议置为 ended（毫秒）；0 表示关闭该行为。
 * 此前只有主持人显式 endMeeting 才会结束会议：人走光后会议会永久停留在 live，
 * 导致"进行中"列表、后台在线会议统计、站内待加入提醒长期出现幽灵数据。
 */
const EMPTY_ROOM_GRACE_MS = envMs("MEETING_EMPTY_ROOM_GRACE_MS", 180_000);

/**
 * 主持人**被动离线**（断网 / 崩溃 / 关页面）后允许重连的窗口（毫秒）；0 表示关闭。
 * - 窗口内主持人回来 → 会议继续
 * - 超时仍未回来 → 自动结束会议
 * 注意：主持人**主动离开**（点"离开/结束"）不走这里，由 closeMeeting 立即结束；
 * 主持人从未入会过的会议也不适用（避免早到的参会者被误结束）。
 */
const HOST_RECONNECT_GRACE_MS = envMs("MEETING_HOST_RECONNECT_GRACE_MS", 300_000);

/**
 * 扫描"服务重启后遗留的 live 会议"的周期（毫秒）；0 表示关闭。
 * 房间是内存态，重启后自动结束定时器随之丢失，只能靠这个兜底扫描收尾。
 */
const STALE_SWEEP_INTERVAL_MS = envMs("MEETING_STALE_SWEEP_MS", 60_000);

/** 强制静音的稳定标识：登录用户用 userId（重连换 peerId 仍是同一人），访客退化为 peerId。 */
function mutedKey(media: { userId: number | null; peerId: string }) {
  return media.userId != null ? `u:${media.userId}` : `p:${media.peerId}`;
}

/** 由 producer 推导成员摄像头/麦克风是否开启（无轨或已暂停即视为关闭）。 */
function peerMediaFlags(media: PeerMedia) {
  let camEnabled = false;
  let micEnabled = false;
  for (const producer of media.producers.values()) {
    if (producer.paused) continue;
    const source = producerSource(
      producer.kind as "audio" | "video",
      (producer.appData ?? {}) as Record<string, unknown>
    );
    if (source === "camera") camEnabled = true;
    else if (source === "microphone") micEnabled = true;
  }
  return { camEnabled, micEnabled };
}

/**
 * 刷新会议活跃时间，供"服务重启后遗留 live 会议"的兜底扫描判断。
 * 出错静默忽略：升级未到位时该列可能还不存在。
 */
async function touchMeetingActive(meetingId: string, db: Db) {
  try {
    await db.query(
      `UPDATE meetings SET last_active_at = ${nowSql(db)} WHERE id = ?`,
      [meetingId]
    );
  } catch {
    /* 忽略 */
  }
}

/**
 * 入会快照的成员列表：除基本信息外带上媒体与录制状态，使后入会者无需等待
 * 增量消息即可正确显示"谁开了摄像头/麦克风、谁在录制"。
 */
function admittedPeerList(state: RoomState) {
  return state.room.listAdmittedPeers().map((p) => {
    const media = state.peers.get(p.peerId);
    const flags = media
      ? peerMediaFlags(media)
      : { camEnabled: false, micEnabled: false };
    return {
      peerId: p.peerId,
      displayName: p.displayName,
      role: p.role,
      handRaised: p.handRaised,
      camEnabled: flags.camEnabled,
      micEnabled: flags.micEnabled,
      recording: p.recording,
    };
  });
}

function broadcastAdmitted(
  state: RoomState,
  msg: ServerMessage,
  exceptPeerId?: string
) {
  for (const p of state.room.listAdmittedPeers()) {
    if (exceptPeerId && p.peerId === exceptPeerId) continue;
    const media = state.peers.get(p.peerId);
    if (media) send(media.ws, msg);
  }
}

function broadcastHosts(state: RoomState, msg: ServerMessage) {
  for (const p of state.room.listAdmittedPeers()) {
    if (p.role !== "host") continue;
    const media = state.peers.get(p.peerId);
    if (media) send(media.ws, msg);
  }
}

function announceProducerClosed(
  state: RoomState,
  peerId: string,
  producerId: string,
  exceptPeerId?: string,
  source?: ProducerSource
) {
  broadcastAdmitted(
    state,
    { type: "producerClosed", producerId, peerId, source },
    exceptPeerId
  );
}

async function closePeerMedia(state: RoomState, media: PeerMedia) {
  for (const c of media.consumers.values()) {
    try {
      c.close();
    } catch {
      /* ignore */
    }
  }
  for (const [producerId, p] of [...media.producers]) {
    media.producers.delete(producerId);
    const pAppData = (p.appData ?? {}) as Record<string, unknown>;
    const pSource = producerSource(p.kind as "audio" | "video", pAppData);
    announceProducerClosed(state, media.peerId, producerId, media.peerId, pSource);
    try {
      if (!p.closed) p.close();
    } catch {
      /* ignore */
    }
  }
  for (const t of media.transports.values()) {
    try {
      t.close();
    } catch {
      /* ignore */
    }
  }
  media.consumers.clear();
  media.producers.clear();
  media.transports.clear();
  media.sendTransport = undefined;
  media.recvTransport = undefined;
}

export function createSignalHandler(db: Db) {
  const rooms = new Map<string, RoomState>();
  /** Per-meetingId lock so concurrent first joins share one room/router. */
  const roomInit = new Map<string, Promise<RoomState>>();
  const wsToPeer = new Map<WebSocket, string>();

  async function getOrCreateRoom(
    meetingId: string,
    waitingRoomEnabled: boolean,
    recordAllowed: boolean,
    allowShareDefault: boolean
  ): Promise<RoomState> {
    const existing = rooms.get(meetingId);
    if (existing) return existing;
    let pending = roomInit.get(meetingId);
    if (!pending) {
      pending = (async () => {
        const existing2 = rooms.get(meetingId);
        if (existing2) return existing2;
        const router = await createRouter();
        const state: RoomState = {
          room: new MeetingRoom({
            meetingId,
            waitingRoomEnabled,
            // 共享权限来自会议设置（此前硬编码 true，房间重建/重启后会丢失主持人的关闭动作）
            allowShareDefault,
            recordAllowed,
          }),
          router,
          peers: new Map(),
          mutedByHost: new Set(),
          hostJoined: false,
        };
        rooms.set(meetingId, state);
        return state;
      })().finally(() => roomInit.delete(meetingId));
      roomInit.set(meetingId, pending);
    }
    return pending;
  }

  function requirePeer(ws: WebSocket): PeerMedia | null {
    const id = wsToPeer.get(ws);
    if (!id) return null;
    for (const state of rooms.values()) {
      const media = state.peers.get(id);
      if (media) return media;
    }
    return null;
  }

  function getStateForPeer(peerId: string): RoomState | null {
    for (const state of rooms.values()) {
      if (state.peers.has(peerId)) return state;
    }
    return null;
  }

  function findProducerOwner(
    state: RoomState,
    producerId: string
  ): { peerId: string; producer: Producer } | null {
    for (const media of state.peers.values()) {
      const producer = media.producers.get(producerId);
      if (producer) return { peerId: media.peerId, producer };
    }
    return null;
  }

  /** After joined/admit, replay other peers' producers so the new peer can consume. */
  function replayProducersToPeer(state: RoomState, toPeerId: string) {
    const target = state.peers.get(toPeerId);
    if (!target) return;
    for (const media of state.peers.values()) {
      if (media.peerId === toPeerId) continue;
      for (const producer of media.producers.values()) {
        const appData = (producer.appData ?? {}) as Record<string, unknown>;
        const source = producerSource(
          producer.kind as "audio" | "video",
          appData
        );
        send(target.ws, {
          type: "newProducer",
          peerId: media.peerId,
          producerId: producer.id,
          kind: producer.kind as "audio" | "video",
          appData,
          paused: producer.paused,
          source,
        });
      }
    }
  }

  /** 待执行的"空置自动结束"定时器：meetingId → timer */
  const emptyRoomTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function cancelEmptyRoomTimer(meetingId: string) {
    const timer = emptyRoomTimers.get(meetingId);
    if (timer) {
      clearTimeout(timer);
      emptyRoomTimers.delete(meetingId);
    }
  }

  function scheduleEmptyRoomEnd(meetingId: string) {
    if (EMPTY_ROOM_GRACE_MS <= 0) return;
    cancelEmptyRoomTimer(meetingId);
    const timer: ReturnType<typeof setTimeout> & { unref?: () => void } =
      setTimeout(() => {
        emptyRoomTimers.delete(meetingId);
        void endEmptyMeeting(meetingId);
      }, EMPTY_ROOM_GRACE_MS);
    // 待结束的会议不应该阻止进程退出
    timer.unref?.();
    emptyRoomTimers.set(meetingId, timer);
  }

  /**
   * 空置宽限期到点：若房间仍然没人，则把会议置为 ended。
   * 只处理 status='live' 的记录（已结束/未开始的会议不动），
   * 并且只要宽限期内有人回来（房间里有 peer）就直接放弃。
   */
  async function endEmptyMeeting(meetingId: string) {
    const current = rooms.get(meetingId);
    if (current && current.peers.size > 0) return;
    await markMeetingEnded(meetingId);
    const left = rooms.get(meetingId);
    if (left && left.peers.size === 0) {
      try {
        left.router.close();
      } catch {
        /* ignore */
      }
      rooms.delete(meetingId);
    }
  }

  /** 只更新库里的会议状态（房间已销毁、无需通知任何人时使用）。 */
  async function markMeetingEnded(meetingId: string) {
    try {
      await db.query(
        `UPDATE meetings SET status = 'ended', ended_at = ${nowSql(db)} WHERE id = ? AND status = 'live'`,
        [meetingId]
      );
    } catch (err) {
      console.error("auto end meeting failed", err);
    }
  }

  /** 待执行的"主持人缺失自动结束"定时器：meetingId → timer */
  const hostReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function cancelHostReconnectTimer(meetingId: string) {
    const timer = hostReconnectTimers.get(meetingId);
    if (timer) {
      clearTimeout(timer);
      hostReconnectTimers.delete(meetingId);
    }
  }

  function hasHost(state: RoomState) {
    return state.room.listAdmittedPeers().some((p) => p.role === "host");
  }

  /**
   * 主持人重连窗口计时：
   * - 主持人在场 → 记录"主持人来过"并取消计时
   * - 主持人从没进过这个会议 → 不适用（参会者早到不该被结束），交给空置规则兜底
   * - 主持人被动离线且曾入会 → 开始计时（已在计时则不重置，从首次离线时刻起算）
   * - 主持人主动离开的场景不经过这里（leavePeer 直接结束会议）
   */
  function refreshHostReconnectTimer(state: RoomState) {
    const meetingId = state.room.meetingId;
    if (hasHost(state)) {
      state.hostJoined = true;
      cancelHostReconnectTimer(meetingId);
      return;
    }
    if (!state.hostJoined) {
      cancelHostReconnectTimer(meetingId);
      return;
    }
    if (HOST_RECONNECT_GRACE_MS <= 0) return;
    if (hostReconnectTimers.has(meetingId)) return; // 已在计时
    const timer: ReturnType<typeof setTimeout> & { unref?: () => void } =
      setTimeout(() => {
        hostReconnectTimers.delete(meetingId);
        void endWhenHostMissing(meetingId);
      }, HOST_RECONNECT_GRACE_MS);
    timer.unref?.();
    hostReconnectTimers.set(meetingId, timer);
  }

  async function endWhenHostMissing(meetingId: string) {
    const state = rooms.get(meetingId);
    if (!state) {
      // 房间已销毁（主持人独自离线后房间被回收）→ 只收尾库里状态
      await markMeetingEnded(meetingId);
      return;
    }
    if (state.room.ended) return;
    if (hasHost(state)) return; // 主持人在窗口内回来了
    console.warn(`[rtc] meeting ${meetingId} auto ended: host offline too long`);
    await closeMeeting(state);
  }

  /** 结束会议：置库状态、通知所有人、关闭全部连接并销毁房间。 */
  async function closeMeeting(state: RoomState) {
    const meetingId = state.room.meetingId;
    state.room.ended = true;
    try {
      await db.query(
        `UPDATE meetings SET status = 'ended', ended_at = ${nowSql(db)} WHERE id = ?`,
        [meetingId]
      );
    } catch (err) {
      console.error("endMeeting db update failed", err);
    }
    broadcastAdmitted(state, { type: "meetingEnded" });
    // 等待室里的成员收不到 broadcastAdmitted，需要单独通知
    for (const mediaPeer of state.peers.values()) {
      const p = state.room.getPeer(mediaPeer.peerId);
      if (p?.inWaitingRoom) send(mediaPeer.ws, { type: "meetingEnded" });
    }
    for (const mediaPeer of [...state.peers.values()]) {
      await closePeerMedia(state, mediaPeer);
      wsToPeer.delete(mediaPeer.ws);
      try {
        mediaPeer.ws.close();
      } catch {
        /* ignore */
      }
    }
    state.peers.clear();
    try {
      state.router.close();
    } catch {
      /* ignore */
    }
    rooms.delete(meetingId);
    cancelEmptyRoomTimer(meetingId);
    cancelHostReconnectTimer(meetingId);
  }

  /** 焦点成员离场后清空焦点并广播，避免残留指向已离开成员的焦点。 */
  function clearFocusIfPeerLeft(state: RoomState, peerId: string) {
    if (state.room.focusPeerId !== peerId) return;
    state.room.focusPeerId = null;
    broadcastAdmitted(state, {
      type: "layout",
      layout: state.room.layout,
      focusPeerId: null,
    });
  }

  /**
   * 同一账号只允许一个在场会话：新会话入会时踢掉旧会话。
   * 旧端收到 kicked(replaced_by_new_session) 后清理本地状态并退回首页。
   */
  async function removeOtherSessions(
    state: RoomState,
    userId: number,
    keepPeerId: string
  ) {
    for (const [peerId, media] of [...state.peers]) {
      if (peerId === keepPeerId || media.userId !== userId) continue;
      const roomPeer = state.room.getPeer(peerId);
      const wasAdmitted = roomPeer != null && !roomPeer.inWaitingRoom;
      state.room.remove(peerId);
      state.peers.delete(peerId);
      wsToPeer.delete(media.ws);
      send(media.ws, { type: "kicked", reason: "replaced_by_new_session" });
      await closePeerMedia(state, media);
      clearFocusIfPeerLeft(state, peerId);
      if (wasAdmitted) broadcastAdmitted(state, { type: "peerLeft", peerId });
      else broadcastHosts(state, { type: "peerLeft", peerId });
      try {
        media.ws.close();
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 兜底扫描：房间是内存态，服务重启后"空置/主持人缺席"定时器不复存在，
   * 只能靠这个周期任务把"已无人但仍是 live"的会议收尾。
   * 只处理确实被使用过（last_active_at 非空）且本进程没有活跃房间的会议，
   * 因此不会误伤"建好后一直没人入会"的会议。
   */
  async function sweepStaleMeetings() {
    const grace = Math.max(EMPTY_ROOM_GRACE_MS, HOST_RECONNECT_GRACE_MS);
    if (grace <= 0) return;
    try {
      const [rows] = await db.query(
        `SELECT id, last_active_at FROM meetings
         WHERE status = 'live' AND last_active_at IS NOT NULL`
      );
      for (const row of rows as Array<{ id: unknown; last_active_at: unknown }>) {
        const meetingId = String(row.id);
        if (rooms.has(meetingId)) continue; // 本进程仍有活跃房间
        const at = new Date(row.last_active_at as string).getTime();
        if (!Number.isFinite(at) || Date.now() - at < grace) continue;
        try {
          await db.query(
            `UPDATE meetings SET status = 'ended', ended_at = ${nowSql(db)} WHERE id = ? AND status = 'live'`,
            [meetingId]
          );
          console.warn(`[rtc] stale meeting ${meetingId} auto ended`);
        } catch (err) {
          console.error("stale meeting sweep failed", err);
        }
      }
    } catch {
      // last_active_at 列尚未迁移到位时会查询失败 → 静默跳过
    }
  }

  if (STALE_SWEEP_INTERVAL_MS > 0) {
    const sweepTimer = setInterval(
      () => void sweepStaleMeetings(),
      STALE_SWEEP_INTERVAL_MS
    );
    (sweepTimer as { unref?: () => void }).unref?.();
  }

  /**
   * 准入一名等待中的成员：置为已入会、下发 joined 快照、重放媒体、广播 peerJoined。
   * 主持人逐个准入与"关闭等待室时全部准入"共用同一实现，避免两条路径行为漂移。
   */
  async function admitPeer(
    state: RoomState,
    targetPeerId: string
  ): Promise<boolean> {
    const target = state.room.getPeer(targetPeerId);
    const targetMedia = state.peers.get(targetPeerId);
    if (!target || !targetMedia) return false;
    state.room.admit(targetPeerId);

    // ── 准入后更新会议邀请名单状态：已入会 ──
    if (targetMedia.userId != null) {
      try {
        await db.query(
          `UPDATE meeting_invitations SET status = 'attended', joined_at = ${nowSql(db)} WHERE meeting_id = ? AND user_id = ?`,
          [state.room.meetingId, targetMedia.userId]
        );
      } catch {
        // 忽略
      }
    }

    send(targetMedia.ws, {
      type: "joined",
      peerId: target.peerId,
      meetingId: state.room.meetingId,
      role: target.role,
      inWaitingRoom: false,
      waitingRoomEnabled: state.room.waitingRoomEnabled,
      recordAllowed: state.room.recordAllowed,
      // 等待室准入后入会同样同步当前布局/焦点/共享权限
      layout: state.room.layout,
      focusPeerId: state.room.focusPeerId,
      allowShare: state.room.allowShareDefault,
      peers: admittedPeerList(state).filter((p) => p.peerId !== targetPeerId),
    });
    replayProducersToPeer(state, targetPeerId);
    broadcastAdmitted(
      state,
      {
        type: "peerJoined",
        peerId: target.peerId,
        displayName: target.displayName,
        role: target.role,
      },
      targetPeerId
    );
    // 主持人也可能从等待室被放进来 → 重排缺席计时
    refreshHostReconnectTimer(state);
    return true;
  }

  /**
   * 成员离场。
   *
   * 主持人的离开（无论是收到 leave 消息，还是断网/崩溃/关页面导致连接断开）一律视为
   * "可重连的离开"：保留房间与路由，给 HOST_RECONNECT_GRACE_MS 重连窗口，超时未归才
   * 结束会议。这样"浏览器返回 / 路由跳走"等误操作不会直接散会，主持人可以重新进入。
   *
   * 主持人主动散会走的是 host action endMeeting（前端给主持人的也是"结束会议"按钮），
   * 那条路径仍然立即结束。
   */
  async function leavePeer(ws: WebSocket, announce = true) {
    const id = wsToPeer.get(ws);
    if (!id) return;
    wsToPeer.delete(ws);
    const state = getStateForPeer(id);
    if (!state) return;
    const media = state.peers.get(id);
    if (media) {
      await closePeerMedia(state, media);
      state.peers.delete(id);
    }
    const peer = state.room.getPeer(id);
    const wasAdmitted = peer != null && !peer.inWaitingRoom;
    const wasHost = wasAdmitted && peer?.role === "host";
    const leaveMeetingId = state.room.meetingId;
    const leaveUserId = media?.userId ?? null;

    // ── 更新会议邀请名单状态：已离开 ──
    // 同一账号可能多端同时参会（多标签页 / PC+手机）。只有该用户已无其他在场会话
    // 时才把邀请退回 pending，否则会出现"一端退出、另一端仍在会中，站内通知却又
    // 提示待加入"的矛盾状态。
    const stillPresent =
      leaveUserId != null &&
      [...state.peers.values()].some((m) => m.userId === leaveUserId);
    if (peer && wasAdmitted && leaveUserId != null && !stillPresent) {
      try {
        await db.query(
          `UPDATE meeting_invitations SET status = 'pending' WHERE meeting_id = ? AND user_id = ?`,
          [leaveMeetingId, leaveUserId],
        );
      } catch {
        // 忽略
      }
    }
    await touchMeetingActive(leaveMeetingId, db);
    state.room.remove(id);
    // 焦点成员离场 → 清空焦点，避免残留指向已离开成员
    clearFocusIfPeerLeft(state, id);

    if (announce) {
      if (wasAdmitted) {
        broadcastAdmitted(state, { type: "peerLeft", peerId: id });
      } else {
        // Waiting peer left — hosts need peerLeft to clear waiting UI
        broadcastHosts(state, { type: "peerLeft", peerId: id });
      }
    }
    // 主持人离开时即使房间空了也保留房间与路由：等他在重连窗口内回来
    if (state.peers.size === 0 && !wasHost) {
      try {
        state.router.close();
      } catch {
        /* ignore */
      }
      rooms.delete(state.room.meetingId);
      // 房间已空：宽限期内若仍无人回来，则把会议置为 ended（避免幽灵 live 状态）
      scheduleEmptyRoomEnd(state.room.meetingId);
    }
    // 主持人不在场 → 重排重连窗口计时
    refreshHostReconnectTimer(state);
  }

  async function handleJoin(ws: WebSocket, message: Extract<ClientMessage, { type: "join" }>) {
    const auth = await validateJoinToken(db, message.token);
    if (!auth) {
      send(ws, { type: "error", message: "invalid_token" });
      return;
    }
    if (auth.meetingStatus === "ended") {
      send(ws, { type: "error", message: "meeting_ended" });
      return;
    }

    // Replace any previous session on this socket
    await leavePeer(ws, true);

    const state = await getOrCreateRoom(
      auth.meetingId,
      auth.waitingRoomEnabled,
      auth.recordAllowed,
      auth.allowShare
    );
    if (state.room.ended) {
      send(ws, { type: "error", message: "meeting_ended" });
      return;
    }
    // 有人回来参会，取消待执行的"空置自动结束"
    cancelEmptyRoomTimer(auth.meetingId);

    const id = peerId();
    const displayName =
      auth.displayName?.trim() || message.displayName;
    const role = auth.role as UserRole;
    const peer = state.room.addPeer({ peerId: id, displayName, role });

    const media: PeerMedia = {
      peerId: id,
      meetingId: auth.meetingId,
      userId: auth.userId ? Number(auth.userId) : null,
      ws,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    };
    state.peers.set(id, media);
    wsToPeer.set(ws, id);

    // 同一账号只允许一个在场会话：新端入会时顶掉旧端，
    // 避免同一用户出现两个 peer（重复音视频、邀请状态互相覆盖）。
    if (media.userId != null) {
      await removeOtherSessions(state, media.userId, id);
    }

    if (peer.inWaitingRoom) {
      send(ws, { type: "waiting", peerId: id, displayName });
      broadcastHosts(state, { type: "waiting", peerId: id, displayName });
      refreshHostReconnectTimer(state);
      return;
    }

    // ── 更新会议邀请名单状态：已入会 ──
    if (media.userId != null) {
      try {
        await db.query(
          `UPDATE meeting_invitations SET status = 'attended', joined_at = ${nowSql(db)} WHERE meeting_id = ? AND user_id = ?`,
          [auth.meetingId, media.userId],
        );
      } catch {
        // 忽略
      }
    }
    await touchMeetingActive(auth.meetingId, db);

    send(ws, {
      type: "joined",
      peerId: id,
      meetingId: auth.meetingId,
      role,
      inWaitingRoom: false,
      waitingRoomEnabled: state.room.waitingRoomEnabled,
      recordAllowed: state.room.recordAllowed,
      // 带上当前布局/焦点/共享权限：主持人已切到演讲者或培训、或已关闭共享时，
      // 后入会者直接同步，而不是停留在前端默认值
      layout: state.room.layout,
      focusPeerId: state.room.focusPeerId,
      allowShare: state.room.allowShareDefault,
      peers: admittedPeerList(state).filter((p) => p.peerId !== id),
    });
    // Late-joining hosts need a waiting-room snapshot (guests may already be waiting).
    if (role === "host") {
      for (const waiting of state.room.listWaitingPeers()) {
        send(ws, {
          type: "waiting",
          peerId: waiting.peerId,
          displayName: waiting.displayName,
        });
      }
    }
    replayProducersToPeer(state, id);
    // 被主持人强制静音的成员：重新入会/刷新后立即恢复静音状态
    if (state.mutedByHost.has(mutedKey(media))) {
      send(ws, { type: "forceMute", audio: true, video: false });
    }
    broadcastAdmitted(
      state,
      {
        type: "peerJoined",
        peerId: id,
        displayName,
        role,
      },
      id
    );
    refreshHostReconnectTimer(state);
  }

  async function handleHost(
    ws: WebSocket,
    message: Extract<ClientMessage, { type: "host" }>
  ) {
    const media = requirePeer(ws);
    if (!media) {
      send(ws, { type: "error", message: "not_joined" });
      return;
    }
    const state = getStateForPeer(media.peerId);
    if (!state) return;
    const self = state.room.getPeer(media.peerId);
    if (!self || self.role !== "host") {
      send(ws, { type: "error", message: "forbidden" });
      return;
    }

    const { action, targetPeerId, allowShare, waitingRoomEnabled } = message;

    switch (action) {
      case "admit": {
        if (!targetPeerId) {
          send(ws, { type: "error", message: "target_required" });
          return;
        }
        if (!(await admitPeer(state, targetPeerId))) {
          send(ws, { type: "error", message: "peer_not_found" });
        }
        break;
      }
      case "deny": {
        if (!targetPeerId) {
          send(ws, { type: "error", message: "target_required" });
          return;
        }
        const targetMedia = state.peers.get(targetPeerId);
        state.room.deny(targetPeerId);
        if (targetMedia) {
          send(targetMedia.ws, { type: "kicked", reason: "denied" });
          await closePeerMedia(state, targetMedia);
          state.peers.delete(targetPeerId);
          wsToPeer.delete(targetMedia.ws);
          try {
            targetMedia.ws.close();
          } catch {
            /* ignore */
          }
        }
        break;
      }
      case "muteAll": {
        for (const p of state.room.listAdmittedPeers()) {
          if (p.role === "host") continue;
          const m = state.peers.get(p.peerId);
          if (m) {
            // 记录"被主持人静音"：重连/刷新后仍然保持静音
            state.mutedByHost.add(mutedKey(m));
            send(m.ws, { type: "forceMute", audio: true, video: false });
          }
        }
        break;
      }
      case "unmuteAll": {
        // 解除全部静音：连同已离场成员的记录一起清掉，
        // 否则他们回来时会莫名其妙仍是静音状态。
        state.mutedByHost.clear();
        for (const p of state.room.listAdmittedPeers()) {
          if (p.role === "host") continue;
          const m = state.peers.get(p.peerId);
          // audio:false → client forces mic on (see MediaRoom forceMute handler)
          if (m) send(m.ws, { type: "forceMute", audio: false, video: false });
        }
        break;
      }
      case "mutePeer": {
        if (!targetPeerId) {
          send(ws, { type: "error", message: "target_required" });
          return;
        }
        const m = state.peers.get(targetPeerId);
        if (m) {
          state.mutedByHost.add(mutedKey(m));
          send(m.ws, { type: "forceMute", audio: true, video: false });
        }
        break;
      }
      case "unmutePeer": {
        if (!targetPeerId) {
          send(ws, { type: "error", message: "target_required" });
          return;
        }
        const m = state.peers.get(targetPeerId);
        // audio:false → 客户端强制开启麦克风（与 unmuteAll 语义一致）
        if (m) {
          state.mutedByHost.delete(mutedKey(m));
          send(m.ws, { type: "forceMute", audio: false, video: false });
        }
        break;
      }
      case "kick": {
        if (!targetPeerId) {
          send(ws, { type: "error", message: "target_required" });
          return;
        }
        const targetMedia = state.peers.get(targetPeerId);
        state.room.remove(targetPeerId);
        if (targetMedia) {
          send(targetMedia.ws, { type: "kicked", reason: "kicked_by_host" });
          await closePeerMedia(state, targetMedia);
          state.peers.delete(targetPeerId);
          wsToPeer.delete(targetMedia.ws);
          broadcastAdmitted(state, { type: "peerLeft", peerId: targetPeerId });
          try {
            targetMedia.ws.close();
          } catch {
            /* ignore */
          }
        }
        break;
      }
      case "setSharePermission": {
        const allow = allowShare ?? true;
        state.room.setSharePermission(allow);
        // 落库：否则房间销毁重建（人走光后再有人入会）会回退到会议创建时的值
        try {
          await db.query(
            `UPDATE meetings SET allow_share = ? WHERE id = ?`,
            [allow ? 1 : 0, state.room.meetingId]
          );
        } catch (err) {
          console.error("setSharePermission db update failed", err);
        }
        broadcastAdmitted(state, { type: "sharePermission", allowed: allow });
        break;
      }
      case "setWaitingRoom": {
        const enabled = waitingRoomEnabled ?? true;
        state.room.setWaitingRoom(enabled);
        // 落库：否则房间销毁重建后会回退到会议创建时的等待室设置
        try {
          await db.query(
            `UPDATE meetings SET waiting_room_enabled = ? WHERE id = ?`,
            [enabled ? 1 : 0, state.room.meetingId]
          );
        } catch (err) {
          console.error("setWaitingRoom db update failed", err);
        }
        broadcastAdmitted(state, { type: "waitingRoomChanged", enabled });
        if (enabled) {
          // 等待中的成员收不到 broadcastAdmitted，需单独告知开关变化，
          // 否则其界面会停留在旧的"等待批准"语义上。
          for (const waiting of state.room.listWaitingPeers()) {
            const m = state.peers.get(waiting.peerId);
            if (m) send(m.ws, { type: "waitingRoomChanged", enabled });
          }
        } else {
          // 关闭等待室等价于"全部准入"：否则等待中的成员会永久卡在等待室，
          // 与"等待室已关闭"的房间状态互相矛盾。
          for (const waiting of [...state.room.listWaitingPeers()]) {
            await admitPeer(state, waiting.peerId);
          }
        }
        break;
      }
      case "setRecordAllowed": {
        const allowed = message.recordAllowed ?? false;
        state.room.setRecordAllowed(allowed);
        try {
          await db.query(
            `UPDATE meetings SET record_allowed = ? WHERE id = ?`,
            [allowed ? 1 : 0, state.room.meetingId]
          );
        } catch (err) {
          console.error("setRecordAllowed db update failed", err);
        }
        broadcastAdmitted(state, { type: "recordAllowedChanged", allowed });
        break;
      }
      case "endMeeting": {
        // 与"空置 / 主持人缺席自动结束"共用同一套收尾逻辑
        await closeMeeting(state);
        break;
      }
    }
  }

  function requireAdmitted(ws: WebSocket): { media: PeerMedia; state: RoomState } | null {
    const media = requirePeer(ws);
    if (!media) {
      send(ws, { type: "error", message: "not_joined" });
      return null;
    }
    const state = getStateForPeer(media.peerId);
    if (!state) {
      send(ws, { type: "error", message: "room_missing" });
      return null;
    }
    const peer = state.room.getPeer(media.peerId);
    if (!peer || peer.inWaitingRoom) {
      send(ws, { type: "error", message: "in_waiting_room" });
      return null;
    }
    if (state.room.ended) {
      send(ws, { type: "error", message: "meeting_ended" });
      return null;
    }
    return { media, state };
  }

  async function handleMessage(ws: WebSocket, raw: string) {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      send(ws, { type: "error", message: "invalid_json" });
      return;
    }

    const parsed = ClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      send(ws, {
        type: "error",
        message: parsed.error.issues[0]?.message ?? "invalid_message",
      });
      return;
    }

    const message = parsed.data;

    try {
      switch (message.type) {
        case "ping":
          // 应用层心跳：无需已入会，收到即回 pong
          send(ws, { type: "pong" });
          break;

        case "join":
          await handleJoin(ws, message);
          break;

        case "leave":
          await leavePeer(ws, true);
          break;

        case "raiseHand": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const peer = ctx.state.room.getPeer(ctx.media.peerId);
          if (!peer) return;
          peer.handRaised = message.raised;
          broadcastAdmitted(ctx.state, {
            type: "handRaised",
            peerId: peer.peerId,
            raised: message.raised,
          });
          break;
        }

        case "chat": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const peer = ctx.state.room.getPeer(ctx.media.peerId);
          if (!peer) return;
          broadcastAdmitted(ctx.state, {
            type: "chat",
            peerId: peer.peerId,
            displayName: peer.displayName,
            text: message.text,
            at: new Date().toISOString(),
          });
          break;
        }

        case "recordingStarted": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const peer = ctx.state.room.getPeer(ctx.media.peerId);
          if (!peer) return;
          // 主持人始终可录制；普通参会者需主持人开启"开启录制"
          if (peer.role !== "host" && !ctx.state.room.recordAllowed) {
            send(ws, { type: "error", message: "recording_not_allowed" });
            return;
          }
          peer.recording = true;
          broadcastAdmitted(ctx.state, {
            type: "peerRecording",
            peerId: peer.peerId,
            displayName: peer.displayName,
            active: true,
          });
          break;
        }

        case "recordingStopped": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const peer = ctx.state.room.getPeer(ctx.media.peerId);
          if (!peer) return;
          peer.recording = false;
          broadcastAdmitted(ctx.state, {
            type: "peerRecording",
            peerId: peer.peerId,
            displayName: peer.displayName,
            active: false,
          });
          break;
        }

        case "setLayout": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const peer = ctx.state.room.getPeer(ctx.media.peerId);
          if (!peer || peer.role !== "host") {
            send(ws, { type: "error", message: "forbidden" });
            return;
          }
          ctx.state.room.layout = message.layout;
          // 切换布局即清除焦点：避免培训模式里点过的焦点残留，
          // 导致切回演讲者布局仍显示旧焦点画面（表现如"卡在培训模式"）。
          ctx.state.room.focusPeerId = null;
          broadcastAdmitted(ctx.state, {
            type: "layout",
            layout: message.layout,
            focusPeerId: ctx.state.room.focusPeerId,
          });
          break;
        }

        case "setFocus": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const peer = ctx.state.room.getPeer(ctx.media.peerId);
          if (!peer || peer.role !== "host") {
            send(ws, { type: "error", message: "forbidden" });
            return;
          }
          ctx.state.room.focusPeerId = message.peerId;
          broadcastAdmitted(ctx.state, {
            type: "layout",
            layout: ctx.state.room.layout,
            focusPeerId: message.peerId,
          });
          break;
        }

        case "host":
          await handleHost(ws, message);
          break;

        case "getRouterRtpCapabilities": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          send(ws, {
            type: "routerRtpCapabilities",
            rtpCapabilities: ctx.state.router.rtpCapabilities,
          });
          break;
        }

        case "createWebRtcTransport": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const transport = await createWebRtcTransport(ctx.state.router);
          ctx.media.transports.set(transport.id, transport);
          if (message.direction === "send") {
            ctx.media.sendTransport = transport;
          } else {
            ctx.media.recvTransport = transport;
          }
          // 监控 ICE/DTLS 连接状态：媒体面不通（MEDIASOUP_ANNOUNCED_IP 配错、
          // UDP 40000-41000 未放行等）时信令依然正常，若不上报客户端只会
          // 静默黑屏。failed 时记录日志并主动通知前端提示。
          // 注意：服务端 WebRtcTransport 只有 icestatechange/dtlsstatechange
          // 事件（connectionstatechange 是客户端 mediasoup-client 的 API）。
          const notifyMediaState = (what: string, state: string) => {
            if (state !== "failed") return;
            console.warn(
              `[rtc] transport ${transport.id} (${message.direction}) ${what} ${state}`
            );
            send(ws, {
              type: "mediaState",
              state: "failed",
              transportId: transport.id,
            });
          };
          transport.on("icestatechange", (state) =>
            notifyMediaState("ice", state)
          );
          transport.on("dtlsstatechange", (state) =>
            notifyMediaState("dtls", state)
          );
          send(ws, {
            type: "transportCreated",
            direction: message.direction,
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
          });
          break;
        }

        case "connectWebRtcTransport": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const transport = ctx.media.transports.get(message.transportId);
          if (!transport) {
            send(ws, { type: "error", message: "transport_not_found" });
            return;
          }
          await transport.connect({
            dtlsParameters: message.dtlsParameters as DtlsParameters,
          });
          send(ws, {
            type: "transportConnected",
            transportId: message.transportId,
          });
          break;
        }

        case "produce": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const peer = ctx.state.room.getPeer(ctx.media.peerId);
          if (!peer) return;
          const appData = (message.appData ?? {}) as Record<string, unknown>;
          if (appData.source === "screen" && !peer.canShare) {
            send(ws, { type: "error", message: "share_not_allowed" });
            return;
          }
          const transport = ctx.media.transports.get(message.transportId);
          if (!transport) {
            send(ws, { type: "error", message: "transport_not_found" });
            return;
          }
          const producer = await transport.produce({
            kind: message.kind,
            rtpParameters: message.rtpParameters as RtpParameters,
            appData,
          });
          ctx.media.producers.set(producer.id, producer);
          producer.on("transportclose", () => {
            if (!ctx.media.producers.has(producer.id)) return;
            ctx.media.producers.delete(producer.id);
            const tcSource = producerSource(
              producer.kind as "audio" | "video",
              appData
            );
            announceProducerClosed(
              ctx.state,
              ctx.media.peerId,
              producer.id,
              ctx.media.peerId,
              tcSource
            );
          });
          send(ws, {
            type: "produced",
            id: producer.id,
            kind: producer.kind as "audio" | "video",
          });
          const source = producerSource(
            producer.kind as "audio" | "video",
            appData
          );
          broadcastAdmitted(
            ctx.state,
            {
              type: "newProducer",
              peerId: ctx.media.peerId,
              producerId: producer.id,
              kind: producer.kind as "audio" | "video",
              appData,
              paused: producer.paused,
              source,
            },
            ctx.media.peerId
          );
          break;
        }

        case "closeProducer": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const producer = ctx.media.producers.get(message.producerId);
          if (!producer) {
            send(ws, { type: "error", message: "producer_not_found" });
            return;
          }
          ctx.media.producers.delete(message.producerId);
          const cpAppData = (producer.appData ?? {}) as Record<string, unknown>;
          const cpSource = producerSource(
            producer.kind as "audio" | "video",
            cpAppData
          );
          announceProducerClosed(
            ctx.state,
            ctx.media.peerId,
            message.producerId,
            undefined,
            cpSource
          );
          try {
            if (!producer.closed) producer.close();
          } catch {
            /* ignore */
          }
          break;
        }

        case "consume": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const recv = ctx.media.recvTransport;
          if (!recv) {
            send(ws, { type: "error", message: "recv_transport_missing" });
            return;
          }
          const owner = findProducerOwner(ctx.state, message.producerId);
          if (!owner) {
            send(ws, { type: "error", message: "producer_not_found" });
            return;
          }
          const rtpCapabilities = message.rtpCapabilities as RtpCapabilities;
          if (
            !ctx.state.router.canConsume({
              producerId: message.producerId,
              rtpCapabilities,
            })
          ) {
            send(ws, { type: "error", message: "cannot_consume" });
            return;
          }
          const consumer = await recv.consume({
            producerId: message.producerId,
            rtpCapabilities,
            paused: true,
          });
          ctx.media.consumers.set(consumer.id, consumer);
          consumer.on("transportclose", () => {
            ctx.media.consumers.delete(consumer.id);
          });
          send(ws, {
            type: "consumed",
            id: consumer.id,
            producerId: message.producerId,
            kind: consumer.kind as "audio" | "video",
            rtpParameters: consumer.rtpParameters,
            peerId: owner.peerId,
            appData: owner.producer.appData as Record<string, unknown>,
          });
          break;
        }

        case "resumeConsumer": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const consumer = ctx.media.consumers.get(message.consumerId);
          if (!consumer) {
            send(ws, { type: "error", message: "consumer_not_found" });
            return;
          }
          await consumer.resume();
          break;
        }

        case "pauseProducer": {
          const ctx = requireAdmitted(ws);
          if (!ctx) return;
          const producer = ctx.media.producers.get(message.producerId);
          if (!producer) {
            send(ws, { type: "error", message: "producer_not_found" });
            return;
          }
          if (message.paused) await producer.pause();
          else await producer.resume();
          const appData = (producer.appData ?? {}) as Record<string, unknown>;
          const source = producerSource(
            producer.kind as "audio" | "video",
            appData
          );
          broadcastAdmitted(
            ctx.state,
            {
              type: "producerPaused",
              peerId: ctx.media.peerId,
              producerId: producer.id,
              kind: producer.kind as "audio" | "video",
              paused: message.paused,
              source,
            },
            ctx.media.peerId
          );
          break;
        }
      }
    } catch (err: any) {
      console.error("signal handler error", err);
      send(ws, {
        type: "error",
        message: err?.message ? String(err.message) : "internal_error",
      });
    }
  }

  return {
    async onConnection(ws: WebSocket) {
      ws.on("message", (data) => {
        const raw = typeof data === "string" ? data : data.toString();
        void handleMessage(ws, raw);
      });
      ws.on("close", () => {
        void leavePeer(ws, true);
      });
      ws.on("error", () => {
        void leavePeer(ws, true);
      });
    },
  };
}
