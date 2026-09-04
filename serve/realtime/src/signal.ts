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
import type { Db } from "./db.js";
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

function admittedPeerList(room: MeetingRoom) {
  return room.listAdmittedPeers().map((p) => ({
    peerId: p.peerId,
    displayName: p.displayName,
    role: p.role,
    handRaised: p.handRaised,
  }));
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
  /** 全局在线连接计数器，避免遍历所有 room */
  let totalPeerCount = 0;
  /** peerId → meetingId 映射，O(1) 查找 peer 所属 room */
  const peerIdToRoom = new Map<string, string>();

  async function getOrCreateRoom(
    meetingId: string,
    waitingRoomEnabled: boolean,
    recordAllowed: boolean
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
            allowShareDefault: true,
            recordAllowed,
          }),
          router,
          peers: new Map(),
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
      peerIdToRoom.delete(id);
      totalPeerCount--;
    }
    const peer = state.room.getPeer(id);
    const wasAdmitted = peer && !peer.inWaitingRoom;
    const leaveMeetingId = state.room.meetingId;
    const leaveUserId = media?.userId ?? null;

    // ── 更新会议邀请名单状态：已离开 ──
    if (peer && wasAdmitted && leaveUserId != null) {
      try {
        await db.query(
          `UPDATE meeting_invitations SET status = 'pending' WHERE meeting_id = ? AND user_id = ?`,
          [leaveMeetingId, leaveUserId],
        );
      } catch {
        // 忽略
      }
    }

    state.room.remove(id);
    if (announce) {
      if (wasAdmitted) {
        broadcastAdmitted(state, { type: "peerLeft", peerId: id });
      } else {
        // Waiting peer left — hosts need peerLeft to clear waiting UI
        broadcastHosts(state, { type: "peerLeft", peerId: id });
      }
    }
    if (state.peers.size === 0) {
      try {
        state.router.close();
      } catch {
        /* ignore */
      }
      rooms.delete(state.room.meetingId);
    }
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

    // ── 全局在线人数限制 ──
    let maxUsers = 20; // 默认值
    try {
      const [rows] = await db.query(
        `SELECT config_value FROM sys_config WHERE config_key = 'sys.online.maxUsers' LIMIT 1`,
      );
      const val = (rows as { config_value?: string }[])[0]?.config_value;
      if (val) {
        const n = Number(val);
        if (Number.isFinite(n)) maxUsers = n;
      }
    } catch {
      // 表不存在或查询失败，使用默认值
    }
    if (totalPeerCount >= maxUsers) {
      send(ws, { type: "error", message: "online_limit_reached" });
      return;
    }

    // Replace any previous session on this socket
    await leavePeer(ws, true);

    const state = await getOrCreateRoom(auth.meetingId, auth.waitingRoomEnabled, auth.recordAllowed);
    if (state.room.ended) {
      send(ws, { type: "error", message: "meeting_ended" });
      return;
    }

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
    peerIdToRoom.set(id, auth.meetingId);
    totalPeerCount++;

    if (peer.inWaitingRoom) {
      send(ws, { type: "waiting", peerId: id, displayName });
      broadcastHosts(state, { type: "waiting", peerId: id, displayName });
      return;
    }

    // ── 更新会议邀请名单状态：已入会 ──
    if (media.userId != null) {
      try {
        await db.query(
          `UPDATE meeting_invitations SET status = 'attended', joined_at = NOW() WHERE meeting_id = ? AND user_id = ?`,
          [auth.meetingId, media.userId],
        );
      } catch {
        // 忽略
      }
    }

    send(ws, {
      type: "joined",
      peerId: id,
      meetingId: auth.meetingId,
      role,
      inWaitingRoom: false,
      waitingRoomEnabled: state.room.waitingRoomEnabled,
      recordAllowed: state.room.recordAllowed,
      peers: admittedPeerList(state.room).filter((p) => p.peerId !== id),
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
        const target = state.room.getPeer(targetPeerId);
        const targetMedia = state.peers.get(targetPeerId);
        if (!target || !targetMedia) {
          send(ws, { type: "error", message: "peer_not_found" });
          return;
        }
        state.room.admit(targetPeerId);

        // ── 准入后更新会议邀请名单状态：已入会 ──
        if (targetMedia.userId != null) {
          try {
            await db.query(
              `UPDATE meeting_invitations SET status = 'attended', joined_at = NOW() WHERE meeting_id = ? AND user_id = ?`,
              [state.room.meetingId, targetMedia.userId],
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
          peers: admittedPeerList(state.room).filter(
            (p) => p.peerId !== targetPeerId
          ),
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
          if (m) send(m.ws, { type: "forceMute", audio: true, video: false });
        }
        break;
      }
      case "unmuteAll": {
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
        if (m) send(m.ws, { type: "forceMute", audio: true, video: false });
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
        broadcastAdmitted(state, { type: "sharePermission", allowed: allow });
        break;
      }
      case "setWaitingRoom": {
        const enabled = waitingRoomEnabled ?? true;
        state.room.setWaitingRoom(enabled);
        broadcastAdmitted(state, { type: "waitingRoomChanged", enabled });
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
        state.room.ended = true;
        try {
          await db.query(
            `UPDATE meetings SET status = 'ended', ended_at = NOW() WHERE id = ?`,
            [state.room.meetingId]
          );
        } catch (err) {
          console.error("endMeeting db update failed", err);
        }
        broadcastAdmitted(state, { type: "meetingEnded" });
        // Also notify waiting peers
        for (const mediaPeer of state.peers.values()) {
          const p = state.room.getPeer(mediaPeer.peerId);
          if (p?.inWaitingRoom) {
            send(mediaPeer.ws, { type: "meetingEnded" });
          }
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
        rooms.delete(state.room.meetingId);
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
