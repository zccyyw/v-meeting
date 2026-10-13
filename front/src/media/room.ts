import { Device } from "mediasoup-client";
import type {
  Consumer,
  Producer,
  RtpCapabilities,
  Transport,
} from "mediasoup-client/types";
import type { ClientMessage, ServerMessage, UserRole } from "@meeting/shared";
import type { SignalClient } from "@/signal/client";

export type WaitingPeer = { peerId: string; displayName: string };

export type PeerInfo = {
  peerId: string;
  displayName: string;
  role: UserRole;
  handRaised: boolean;
  camEnabled: boolean;
  micEnabled: boolean;
  recording: boolean;
};

export type MeetingLayout = "grid" | "speaker" | "training";

export type ChatMessage = {
  peerId: string;
  displayName: string;
  text: string;
  at: string;
};

export type MediaRoomStatus =
  | "idle"
  | "connecting"
  | "reconnecting"
  | "waiting"
  | "joined"
  | "ended"
  | "kicked"
  | "error";

export type MediaRoomSnapshot = {
  status: MediaRoomStatus;
  peerId: string | null;
  role: UserRole | null;
  displayName: string;
  waitingPeers: WaitingPeer[];
  peers: PeerInfo[];
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  screenStreams: Map<string, MediaStream>;
  /** 其他成员的共享内容声音（独立音轨，方案 A），接收端单独播放/调音量 */
  screenAudioStreams: Map<string, MediaStream>;
  micEnabled: boolean;
  camEnabled: boolean;
  handRaised: boolean;
  layout: MeetingLayout;
  /** 各成员到服务器的网络延迟（ms），由各自客户端上报、服务端汇总广播 */
  peerRtt: Record<string, number>;
  /** 主持人控制的"成员画面轮换"开关（培训/演讲布局右侧面板） */
  rotationEnabled: boolean;
  focusPeerId: string | null;
  sharingScreen: boolean;
  canShare: boolean;
  allowShare: boolean;
  waitingRoomEnabled: boolean;
  recordAllowed: boolean;
  chatMessages: ChatMessage[];
  error: string | null;
  /** 非阻断警示（黄色横幅）：媒体消费失败 / 权限受限等，不影响会议继续使用 */
  warning: string | null;
  /** 本地媒体采集降级提示码（非阻断）：no_camera / no_media_devices / media_permission_denied / media_capture_failed */
  localMediaError: string | null;
  endedReason: string | null;
};

type Listener = () => void;

const VIDEO_ENCODINGS = [
  { rid: "r0", maxBitrate: 100_000, scaleResolutionDownBy: 4 },
  { rid: "r1", maxBitrate: 300_000, scaleResolutionDownBy: 2 },
  { rid: "r2", maxBitrate: 900_000 },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class MediaRoom {
  private readonly signal: SignalClient;
  private readonly token: string;
  private readonly displayName: string;

  private unsub: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private pending: Array<{
    pred: (msg: ServerMessage) => boolean;
    resolve: (msg: ServerMessage) => void;
    reject: (err: Error) => void;
  }> = [];

  private device: Device | null = null;
  private sendTransport: Transport | null = null;
  private recvTransport: Transport | null = null;
  private audioProducer: Producer | null = null;
  private videoProducer: Producer | null = null;
  private screenProducer: Producer | null = null;
  /** 屏幕共享的音频轨（独立于麦克风，方案 A）：仅当服务端声明支持时才创建 */
  private screenAudioProducer: Producer | null = null;
  /** 服务端是否支持屏幕共享独立音频（joined.capabilities.screenAudio；旧服务端缺省 false → 降级不发） */
  private serverSupportsScreenAudio = false;
  private consumers = new Map<string, Consumer>();
  private consumerMeta = new Map<
    string,
    { peerId: string; source: "camera" | "screen" | "screen-audio" }
  >();
  private localStream: MediaStream | null = null;
  private localScreenStream: MediaStream | null = null;
  private remoteStreams = new Map<string, MediaStream>();
  private screenStreams = new Map<string, MediaStream>();
  /** 其他成员的共享内容声音（独立音轨），接收端单独播放/调音量 */
  private screenAudioStreams = new Map<string, MediaStream>();
  private mediaReady = false;
  private closed = false;
  private pendingProducers: Extract<ServerMessage, { type: "newProducer" }>[] = [];
  /**
   * 已收到 producerClosed 的 producerId。用于消费竞态保护：`consumeProducer`
   * 的 `recvTransport.consume()` 是异步的，若 producerClosed 在等待期间先到达，
   * 事后登记 consumer 会把“已结束的流”残留进 screenStreams/remoteStreams，
   * 导致本端 hasScreen 恒真、布局被锁在侧栏且主画面卡在黑屏。
   */
  private closedProducerIds = new Set<string>();
  /** 是否正在自动重连（防止并发触发多条重连流程） */
  private reconnecting = false;
  /**
   * 本地轨生命周期监听的卸载函数。浏览器安全模型下，已建立的
   * MediaStreamTrack 绑定获取时的设备：插拔设备/修改系统默认设备
   * 不会自动迁移，只能靠监听 ended（设备拔出）后重新采集并热替换。
   */
  private trackWatchers: (() => void)[] = [];
  /** 防止设备拔出后的重采并发触发 */
  private reacquiring: { audio: boolean; video: boolean } = {
    audio: false,
    video: false,
  };

  private status: MediaRoomStatus = "idle";
  private peerId: string | null = null;
  private role: UserRole | null = null;
  private waitingPeers: WaitingPeer[] = [];
  private peers: PeerInfo[] = [];
  private micEnabled = true;
  private camEnabled = false;
  private handRaised = false;
  private layout: MeetingLayout = "grid";
  private peerRtt = new Map<string, number>();
  private rotationEnabled = false;
  private rttTimer: ReturnType<typeof setInterval> | null = null;
  private focusPeerId: string | null = null;
  private screenFocusPeerId: string | null = null;
  private sharingScreen = false;
  private canShare = true;
  private allowShare = true;
  private waitingRoomEnabled = false;
  private recordAllowed = false;
  private chatMessages: ChatMessage[] = [];
  private error: string | null = null;
  private warning: string | null = null;
  private localMediaError: string | null = null;
  private endedReason: string | null = null;

  constructor(opts: {
    signal: SignalClient;
    token: string;
    displayName: string;
    micEnabled?: boolean;
    camEnabled?: boolean;
  }) {
    this.signal = opts.signal;
    this.token = opts.token;
    this.displayName = opts.displayName;
    if (opts.micEnabled != null) this.micEnabled = opts.micEnabled;
    if (opts.camEnabled != null) this.camEnabled = opts.camEnabled;
    // WebSocket 意外断开时触发自动重连
    this.signal.setUnexpectedCloseHandler(() => {
      void this.handleDisconnect();
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): MediaRoomSnapshot {
    return {
      status: this.status,
      peerId: this.peerId,
      role: this.role,
      displayName: this.displayName,
      waitingPeers: [...this.waitingPeers],
      peers: [...this.peers],
      localStream: this.localStream,
      localScreenStream: this.localScreenStream,
      remoteStreams: new Map(this.remoteStreams),
      screenStreams: new Map(this.screenStreams),
      screenAudioStreams: new Map(this.screenAudioStreams),
      micEnabled: this.micEnabled,
      camEnabled: this.camEnabled,
      handRaised: this.handRaised,
      layout: this.layout,
      peerRtt: Object.fromEntries(this.peerRtt),
      rotationEnabled: this.rotationEnabled,
      focusPeerId: this.screenFocusPeerId ?? this.focusPeerId,
      sharingScreen: this.sharingScreen,
      canShare: this.canShare,
      allowShare: this.allowShare,
      waitingRoomEnabled: this.waitingRoomEnabled,
      recordAllowed: this.recordAllowed,
      chatMessages: [...this.chatMessages],
      error: this.error,
      warning: this.warning,
      localMediaError: this.localMediaError,
      endedReason: this.endedReason,
    };
  }

  async join(): Promise<void> {
    if (this.closed) throw new Error("room_closed");
    this.status = "connecting";
    this.emit();

    await this.signal.connect();
    // 防止重连循环重复订阅消息回调
    if (this.closed) throw new Error("room_closed");
    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }
    this.unsub = this.signal.onMessage((msg) => this.onSignal(msg));

    this.signal.send({
      type: "join",
      token: this.token,
      displayName: this.displayName,
    });

    const first = await this.waitFor(
      (m) =>
        m.type === "waiting" ||
        m.type === "joined" ||
        m.type === "error" ||
        m.type === "kicked" ||
        m.type === "meetingEnded",
      15_000
    );

    if (first.type === "error") {
      this.status = "error";
      this.error = first.message;
      this.emit();
      throw new Error(first.message);
    }
    if (first.type === "kicked") {
      this.status = "kicked";
      this.endedReason = first.reason;
      this.emit();
      return;
    }
    if (first.type === "meetingEnded") {
      this.status = "ended";
      this.endedReason = "meeting_ended";
      this.emit();
      return;
    }
    if (first.type === "waiting") {
      this.peerId = first.peerId;
      this.status = "waiting";
      this.emit();
      return;
    }

    if (first.type !== "joined") {
      throw new Error("unexpected_join_response");
    }

    await this.handleJoined(first);
  }

  admit(targetPeerId: string): void {
    this.signal.send({
      type: "host",
      action: "admit",
      targetPeerId,
    });
    this.waitingPeers = this.waitingPeers.filter((p) => p.peerId !== targetPeerId);
    this.emit();
  }

  deny(targetPeerId: string): void {
    this.signal.send({
      type: "host",
      action: "deny",
      targetPeerId,
    });
    this.waitingPeers = this.waitingPeers.filter((p) => p.peerId !== targetPeerId);
    this.emit();
  }

  setHandRaised(raised: boolean): void {
    this.handRaised = raised;
    this.signal.send({ type: "raiseHand", raised });
    if (this.peerId) {
      this.peers = this.peers.map((p) =>
        p.peerId === this.peerId ? { ...p, handRaised: raised } : p
      );
    }
    this.emit();
  }

  /** 主持人开关"成员画面轮换"（服务端校验 host 并广播全员） */
  setRotation(enabled: boolean): void {
    this.signal.send({ type: "setRotation", enabled });
    // 本地立即生效（主持人自己），服务端广播随后覆盖
    if (this.rotationEnabled !== enabled) {
      this.rotationEnabled = enabled;
      this.emit();
    }
  }

  /**
   * 启动 RTT 周期采集：信令 ping/pong 回显测量（client 发出 → server 回显）。
   * 不用 getStats 的 candidate-pair.currentRoundTripTime——媒体走 TCP 兜底时
   * 不做 STUN consent 测量，该字段无值；信令 RTT 任何传输下都可用且语义一致。
   * 不以 recvTransport 为前提：媒体初始化失败（浏览器过老/媒体端口被阻断）的
   * 成员也上报 RTT，其「有 RTT 但无画面」本身即是媒体故障的定位信号。
   */
  private startRttReporting(): void {
    if (this.rttTimer) return;
    this.rttTimer = setInterval(() => {
      if (this.closed) return;
      this.signal.send({ type: "ping", t: Date.now() });
    }, 5_000);
  }

  private stopRttReporting(): void {
    if (this.rttTimer) {
      clearInterval(this.rttTimer);
      this.rttTimer = null;
    }
  }

  setLayout(layout: MeetingLayout): void {
    this.signal.send({ type: "setLayout", layout });
    // 立即本地生效：避免因服务端回显延迟/丢失导致“主持人切了、自己的画面却没变”。
    // 服务端随后广播的 layout 仍会以权威值覆盖（并同步清除焦点）。
    if (this.layout !== layout) {
      this.layout = layout;
      this.focusPeerId = null;
      this.emit();
    }
  }

  setFocus(peerId: string | null): void {
    this.signal.send({ type: "setFocus", peerId });
  }

  setSharePermission(allow: boolean): void {
    this.signal.send({
      type: "host",
      action: "setSharePermission",
      allowShare: allow,
    });
  }

  setWaitingRoom(enabled: boolean): void {
    this.signal.send({
      type: "host",
      action: "setWaitingRoom",
      waitingRoomEnabled: enabled,
    });
  }

  setRecordAllowed(allowed: boolean): void {
    this.signal.send({
      type: "host",
      action: "setRecordAllowed",
      recordAllowed: allowed,
    });
  }

  notifyRecordingStarted(): void {
    this.signal.send({ type: "recordingStarted" });
  }

  notifyRecordingStopped(): void {
    this.signal.send({ type: "recordingStopped" });
  }

  muteAll(): void {
    this.signal.send({ type: "host", action: "muteAll" });
  }

  unmuteAll(): void {
    this.signal.send({ type: "host", action: "unmuteAll" });
  }

  kickPeer(targetPeerId: string): void {
    this.signal.send({ type: "host", action: "kick", targetPeerId });
  }

  mutePeer(targetPeerId: string): void {
    this.signal.send({ type: "host", action: "mutePeer", targetPeerId });
  }

  unmutePeer(targetPeerId: string): void {
    this.signal.send({ type: "host", action: "unmutePeer", targetPeerId });
  }

  endMeeting(): void {
    this.signal.send({ type: "host", action: "endMeeting" });
  }

  sendChat(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.signal.send({ type: "chat", text: trimmed.slice(0, 2000) });
  }

  async setMicEnabled(enabled: boolean): Promise<void> {
    this.micEnabled = enabled;
    const track = this.localStream?.getAudioTracks()[0];
    if (track) track.enabled = enabled;
    if (this.audioProducer && !this.audioProducer.closed) {
      if (enabled) this.audioProducer.resume();
      else this.audioProducer.pause();
      this.signal.send({
        type: "pauseProducer",
        producerId: this.audioProducer.id,
        paused: !enabled,
      });
    }
    this.emit();
  }

  async setCamEnabled(enabled: boolean): Promise<void> {
    this.camEnabled = enabled;
    const track = this.localStream?.getVideoTracks()[0];
    if (track) track.enabled = enabled;
    if (this.videoProducer && !this.videoProducer.closed) {
      if (enabled) this.videoProducer.resume();
      else this.videoProducer.pause();
      this.signal.send({
        type: "pauseProducer",
        producerId: this.videoProducer.id,
        paused: !enabled,
      });
    }
    this.emit();
  }

  async switchDevice(kind: "audio" | "video", deviceId: string): Promise<void> {
    if (!this.localStream) return;

    try {
      if (kind === "audio") {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });
      const next = stream.getAudioTracks()[0];
      if (!next) return;
      const prev = this.localStream.getAudioTracks()[0];
      this.localStream.addTrack(next);
      if (prev) {
        this.localStream.removeTrack(prev);
        prev.stop();
      }
      next.enabled = this.micEnabled;
      this.watchLocalTracks(this.localStream);
      if (this.audioProducer && !this.audioProducer.closed) {
        await this.audioProducer.replaceTrack({ track: next });
      }
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: deviceId } },
      });
      const next = stream.getVideoTracks()[0];
      if (!next) return;
      const prev = this.localStream.getVideoTracks()[0];
      this.localStream.addTrack(next);
      if (prev) {
        this.localStream.removeTrack(prev);
        prev.stop();
      }
      next.enabled = this.camEnabled;
      this.watchLocalTracks(this.localStream);
      if (this.videoProducer && !this.videoProducer.closed) {
        await this.videoProducer.replaceTrack({ track: next });
      }
    }
    this.emit();
    } catch (err) {
      // 切换设备被拒（权限/设备占用）不应产生未捕获异常，降级为非阻断提示
      const name = err instanceof Error ? err.name : String(err);
      this.localMediaError =
        name === "NotAllowedError" || name === "SecurityError"
          ? "media_permission_denied"
          : "media_capture_failed";
      this.emit();
    }
  }

  async startScreenShare(): Promise<void> {
    if (!this.sendTransport || this.closed) return;
    if (!this.canShare) {
      this.warning = "share_not_allowed";
      this.emit();
      return;
    }
    if (this.sharingScreen) return;

    let stream: MediaStream;
    try {
      // audio:true：共享「标签页」并在浏览器弹窗勾选「共享标签页音频」时才有音频轨；
      // 共享窗口/整屏在多数平台无音频轨（此时不会创建屏幕音频轨）
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : String(err);
      // 用户在共享选择框点"取消"（NotAllowedError: Permission denied by user）
      // 属正常取消，静默返回；不应作为错误打断会议状态
      if (name === "NotAllowedError") return;
      this.error = err instanceof Error ? err.message : "screen_share_failed";
      this.emit();
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (!track) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    track.contentHint = "detail";

    try {
      this.screenProducer = await this.sendTransport.produce({
        track,
        appData: { source: "screen" },
      });
    } catch (err) {
      for (const t of stream.getTracks()) t.stop();
      this.warning =
        err instanceof Error ? err.message : "screen_share_failed";
      this.emit();
      return;
    }

    // 屏幕音频独立轨（方案 A）：仅当服务端声明支持时发布；
    // 无音频轨（窗口/整屏多数平台）或服务端不支持 → 降级为无共享声音，不阻断共享
    const screenAudioTrack = stream.getAudioTracks()[0] ?? null;
    if (screenAudioTrack && this.serverSupportsScreenAudio) {
      try {
        this.screenAudioProducer = await this.sendTransport.produce({
          track: screenAudioTrack,
          appData: { source: "screen" },
        });
        this.warning = "screenShareAudioActive";
      } catch (err) {
        // 音频轨发布失败不阻断共享（降级为无共享声音）
        console.warn(
          "[rtc] screen audio produce failed (share continues without audio):",
          err instanceof Error ? err.message : err,
        );
      }
    } else if (screenAudioTrack) {
      console.info("[rtc] server does not support screen audio; skip");
    } else {
      console.info(
        "[rtc] screen share has no audio track (window/full-screen sharing on most platforms)",
      );
    }

    this.localScreenStream = stream;
    this.sharingScreen = true;
    if (this.peerId) this.screenFocusPeerId = this.peerId;
    track.onended = () => {
      void this.stopScreenShare();
    };
    this.emit();
  }

  async stopScreenShare(): Promise<void> {
    const closeProducer = (producer: Producer | null): string | null => {
      const pid = producer?.id ?? null;
      if (producer && !producer.closed) {
        try {
          producer.close();
        } catch {
          /* ignore */
        }
      }
      return pid;
    };
    const videoProducerId = closeProducer(this.screenProducer);
    this.screenProducer = null;
    const audioProducerId = closeProducer(this.screenAudioProducer);
    this.screenAudioProducer = null;
    for (const pid of [videoProducerId, audioProducerId]) {
      if (pid) {
        try {
          this.signal.send({ type: "closeProducer", producerId: pid });
        } catch {
          /* ignore */
        }
      }
    }
    if (this.localScreenStream) {
      for (const t of this.localScreenStream.getTracks()) t.stop();
      this.localScreenStream = null;
    }
    this.sharingScreen = false;
    if (this.screenFocusPeerId === this.peerId) {
      this.screenFocusPeerId =
        this.screenStreams.size > 0
          ? [...this.screenStreams.keys()][0]!
          : null;
    }
    this.emit();
  }

  /**
   * 监听本地音视频轨生命周期（设备热插拔自愈）：
   * - ended（设备被拔出/禁用）→ 自动重新采集同类设备并热替换 producer；
   * - 不监听 mute：浏览器在省电/采集暂停时也会触发，误报率高。
   */
  private watchLocalTracks(stream: MediaStream): void {
    this.unwatchLocalTracks();
    for (const kind of ["audio", "video"] as const) {
      const track = stream.getTracks().find((t) => t.kind === kind);
      if (!track) continue;
      const onEnded = () => {
        if (this.closed) return;
        console.warn(`[rtc] local ${kind} track ended (device unplugged?), reacquiring`);
        void this.reacquireTrack(kind);
      };
      track.addEventListener("ended", onEnded);
      this.trackWatchers.push(() => track.removeEventListener("ended", onEnded));
    }
  }

  private unwatchLocalTracks(): void {
    for (const off of this.trackWatchers) off();
    this.trackWatchers = [];
  }

  /**
   * 设备拔出后重新采集并热替换。用无 deviceId 约束（取系统当前默认设备）；
   * 无可用设备时提示用户，插入设备后 devicechange → 重新选择设备即恢复。
   */
  private async reacquireTrack(kind: "audio" | "video"): Promise<void> {
    if (this.closed || this.reacquiring[kind]) return;
    this.reacquiring[kind] = true;
    try {
      const constraints: MediaStreamConstraints =
        kind === "audio"
          ? { audio: true, video: false }
          : { audio: false, video: { width: { ideal: 1280 }, height: { ideal: 720 } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const next = (kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks())[0];
      if (!next) throw new Error("no track");
      if (this.closed) {
        for (const t of stream.getTracks()) t.stop();
        return;
      }
      const prev = (
        kind === "audio"
          ? this.localStream?.getAudioTracks()
          : this.localStream?.getVideoTracks()
      )?.[0] ?? null;
      if (this.localStream) {
        if (prev) this.localStream.removeTrack(prev);
        this.localStream.addTrack(next);
      }
      next.enabled = kind === "audio" ? this.micEnabled : this.camEnabled;
      const producer = kind === "audio" ? this.audioProducer : this.videoProducer;
      if (producer && !producer.closed) await producer.replaceTrack({ track: next });
      if (prev) {
        try {
          prev.stop();
        } catch {
          /* ignore */
        }
      }
      console.info(`[rtc] local ${kind} track reacquired after device change`);
    } catch (err) {
      // 无可用设备（拔出后未插入新设备）等场景：提示用户，插入设备后
      // 在设置面板重新选择即可恢复（switchDevice 仍可用）
      this.warning = kind === "audio" ? "audioDeviceLost" : "videoDeviceLost";
      this.emit();
      console.warn(
        `[rtc] reacquire ${kind} track failed:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      this.reacquiring[kind] = false;
    }
  }

  leave(): void {
    try {
      this.signal.send({ type: "leave" });
    } catch {
      /* ignore */
    }
    this.cleanup();
    this.status = "ended";
    this.endedReason = "left";
    this.emit();
  }

  /**
   * WebSocket 意外断开 → 清理媒体资源后按指数退避自动重加入会。
   */
  private async handleDisconnect(): Promise<void> {
    if (this.closed || this.reconnecting) return;
    // 仅在已入会 / 等候室中自动重连，其余状态由调用方处理
    if (this.status !== "joined" && this.status !== "waiting") return;

    this.reconnecting = true;
    this.status = "reconnecting";
    this.error = null;
    this.warning = null;
    this.endedReason = null;
    this.emit();

    // 释放 SFU/媒体资源（保留 closed=false、token、聊天记录与麦克风/摄像头意图）
    this.teardownMedia();
    this.rejectPending(new Error("connection_lost"));

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts && !this.closed; attempt++) {
      if (attempt > 1) {
        await sleep(Math.min(1000 * 2 ** (attempt - 2), 8000));
      }
      if (this.closed) break;
      try {
        await this.join();
        if (!this.closed) {
          this.reconnecting = false;
          this.error = null;
          this.warning = null;
          // 屏幕共享无法无人值守恢复（需要再次授权选择），重连后置为未共享
          this.sharingScreen = false;
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 不可恢复的错误：终止自动重连
        if (
          msg.includes("ended") ||
          msg.includes("invalid_token") ||
          msg.includes("online_limit_reached") ||
          msg.includes("kicked") ||
          msg.includes("room_closed")
        ) {
          this.reconnecting = false;
          this.status = "error";
          this.error = msg;
          this.emit();
          return;
        }
        // 其余错误（网络抖动、服务未就绪等）按退避继续重试
      }
    }

    this.reconnecting = false;
    if (!this.closed) {
      this.status = "error";
      this.error = "reconnect_failed";
      this.emit();
    }
  }

  /** 释放 SFU/媒体资源，但不置 closed，以便后续自动重连复用本实例。 */
  private teardownMedia(): void {
    this.mediaReady = false;
    this.stopRttReporting();
    this.peerRtt.clear();
    this.device = null;

    for (const c of this.consumers.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.consumers.clear();
    this.consumerMeta.clear();

    this.unwatchLocalTracks();
    for (const p of [this.audioProducer, this.videoProducer, this.screenProducer, this.screenAudioProducer]) {
      if (p && !p.closed) {
        try {
          p.close();
        } catch {
          /* ignore */
        }
      }
    }
    this.audioProducer = null;
    this.videoProducer = null;
    this.screenProducer = null;
    this.screenAudioProducer = null;
    this.screenAudioStreams.clear();
    this.sharingScreen = false;
    this.localMediaError = null;

    for (const t of [this.sendTransport, this.recvTransport]) {
      if (t && !t.closed) {
        try {
          t.close();
        } catch {
          /* ignore */
        }
      }
    }
    this.sendTransport = null;
    this.recvTransport = null;

    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    if (this.localScreenStream) {
      for (const t of this.localScreenStream.getTracks()) t.stop();
      this.localScreenStream = null;
    }
    for (const stream of this.remoteStreams.values()) {
      for (const t of stream.getTracks()) t.stop();
    }
    this.remoteStreams.clear();
    for (const stream of this.screenStreams.values()) {
      for (const t of stream.getTracks()) t.stop();
    }
    this.screenStreams.clear();
    this.screenFocusPeerId = null;
    this.closedProducerIds.clear();
  }

  private rejectPending(err: Error): void {
    for (const entry of this.pending) entry.reject(err);
    this.pending = [];
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  private waitFor(
    pred: (msg: ServerMessage) => boolean,
    timeoutMs = 10_000
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const entry = { pred, resolve, reject };
      this.pending.push(entry);
      const timer = setTimeout(() => {
        const idx = this.pending.indexOf(entry);
        if (idx >= 0) this.pending.splice(idx, 1);
        reject(new Error("signal_timeout"));
      }, timeoutMs);
      const origResolve = resolve;
      const origReject = reject;
      entry.resolve = (msg) => {
        clearTimeout(timer);
        origResolve(msg);
      };
      entry.reject = (err) => {
        clearTimeout(timer);
        origReject(err);
      };
    });
  }

  private request<T extends ServerMessage>(
    msg: ClientMessage,
    pred: (m: ServerMessage) => boolean,
    timeoutMs = 10_000
  ): Promise<T> {
    const p = this.waitFor(pred, timeoutMs) as Promise<T>;
    this.signal.send(msg);
    return p;
  }

  private onSignal(msg: ServerMessage): void {
    for (let i = 0; i < this.pending.length; i++) {
      if (this.pending[i]!.pred(msg)) {
        const [entry] = this.pending.splice(i, 1);
        entry!.resolve(msg);
        break;
      }
    }

    switch (msg.type) {
      case "waiting":
        if (this.peerId && msg.peerId === this.peerId) {
          this.status = "waiting";
        } else if (this.role === "host") {
          if (!this.waitingPeers.some((p) => p.peerId === msg.peerId)) {
            this.waitingPeers = [
              ...this.waitingPeers,
              { peerId: msg.peerId, displayName: msg.displayName },
            ];
          }
        }
        this.emit();
        break;

      case "joined":
        // Initial join is handled by join(); this covers admit-from-waiting.
        if (this.status === "waiting") {
          void this.handleJoined(msg).catch((err) => {
            this.status = "error";
            this.error = err instanceof Error ? err.message : "join_failed";
            this.emit();
          });
        }
        break;

      case "peerJoined":
        this.waitingPeers = this.waitingPeers.filter((p) => p.peerId !== msg.peerId);
        if (!this.peers.some((p) => p.peerId === msg.peerId)) {
          this.peers = [
            ...this.peers,
            {
              peerId: msg.peerId,
              displayName: msg.displayName,
              role: msg.role,
              handRaised: false,
              camEnabled: false,
              micEnabled: false,
              recording: false,
            },
          ];
        }
        this.emit();
        break;

      case "peerLeft":
        this.waitingPeers = this.waitingPeers.filter((p) => p.peerId !== msg.peerId);
        this.peers = this.peers.filter((p) => p.peerId !== msg.peerId);
        this.removeRemotePeer(msg.peerId);
        if (this.focusPeerId === msg.peerId) this.focusPeerId = null;
        this.emit();
        break;

      case "handRaised":
        if (msg.peerId === this.peerId) {
          this.handRaised = msg.raised;
        }
        this.peers = this.peers.map((p) =>
          p.peerId === msg.peerId ? { ...p, handRaised: msg.raised } : p
        );
        this.emit();
        break;

      case "layout":
        this.layout = msg.layout;
        this.focusPeerId = msg.focusPeerId;
        this.emit();
        break;

      case "pong":
        // 仅处理带时间戳的 pong（room 的 RTT 探测）；SignalClient 心跳的 pong 无 t
        if (msg.t != null) {
          const rttMs = Math.max(0, Date.now() - msg.t);
          this.signal.send({ type: "networkStats", rttMs });
        }
        break;

      case "rotationChanged":
        this.rotationEnabled = msg.enabled;
        this.emit();
        break;

      case "peerNetworkStats": {
        this.peerRtt = new Map(msg.peers.map((p) => [p.peerId, p.rttMs]));
        this.emit();
        break;
      }

      case "sharePermission":
        this.allowShare = msg.allowed;
        this.canShare = this.role === "host" || msg.allowed;
        if (!this.canShare && this.sharingScreen) {
          void this.stopScreenShare();
        }
        this.emit();
        break;

      case "waitingRoomChanged":
        this.waitingRoomEnabled = msg.enabled;
        this.emit();
        break;

      case "recordAllowedChanged":
        this.recordAllowed = msg.allowed;
        this.emit();
        break;

      case "peerRecording":
        this.peers = this.peers.map((p) =>
          p.peerId === msg.peerId ? { ...p, recording: msg.active } : p
        );
        this.emit();
        break;

      case "chat":
        this.chatMessages = [
          ...this.chatMessages,
          {
            peerId: msg.peerId,
            displayName: msg.displayName,
            text: msg.text,
            at: msg.at,
          },
        ].slice(-200);
        this.emit();
        break;

      case "newProducer": {
        if (msg.peerId === this.peerId) break;
        if (msg.source === "camera") {
          const camOn = msg.paused === undefined ? true : !msg.paused;
          this.peers = this.peers.map((p) =>
            p.peerId === msg.peerId ? { ...p, camEnabled: camOn } : p
          );
          this.emit();
        } else if (msg.source === "microphone") {
          const micOn = msg.paused === undefined ? true : !msg.paused;
          this.peers = this.peers.map((p) =>
            p.peerId === msg.peerId ? { ...p, micEnabled: micOn } : p
          );
          this.emit();
        }
        if (!this.mediaReady) {
          this.pendingProducers.push(msg);
        } else {
          void this.consumeProducer(msg).catch((err) => {
            console.error("consume failed", err);
          });
        }
        break;
      }

      case "producerPaused": {
        if (msg.source === "camera") {
          this.peers = this.peers.map((p) =>
            p.peerId === msg.peerId
              ? { ...p, camEnabled: !msg.paused }
              : p
          );
          this.emit();
        } else if (msg.source === "microphone") {
          this.peers = this.peers.map((p) =>
            p.peerId === msg.peerId
              ? { ...p, micEnabled: !msg.paused }
              : p
          );
          this.emit();
        }
        break;
      }

      case "producerClosed":
        if (msg.source === "camera") {
          this.peers = this.peers.map((p) =>
            p.peerId === msg.peerId ? { ...p, camEnabled: false } : p
          );
        } else if (msg.source === "microphone") {
          this.peers = this.peers.map((p) =>
            p.peerId === msg.peerId ? { ...p, micEnabled: false } : p
          );
        }
        this.removeClosedProducer(msg.producerId, msg.peerId);
        this.emit();
        break;

      case "forceMute":
        // audio/video true = force off; false = force on (used by unmuteAll)
        void this.setMicEnabled(!msg.audio);
        if (msg.video) void this.setCamEnabled(false);
        break;

      case "kicked":
        this.cleanup();
        this.status = "kicked";
        this.endedReason = msg.reason;
        this.emit();
        break;

      case "meetingEnded":
        this.cleanup();
        this.status = "ended";
        this.endedReason = "meeting_ended";
        this.emit();
        break;

      case "mediaState":
        // 媒体连接异常完全静默（不打扰参会用户），仅 console 记录供排查；
        // 自愈由 ICE restart 负责，运维指引（ANNOUNCED_IP/UDP 端口）不进 UI
        if (msg.state === "failed" || msg.state === "disconnected") {
          console.warn(
            `[rtc] server reported media ${msg.state}` +
              (msg.transportId ? ` (transport ${msg.transportId})` : ""),
          );
        }
        break;

      case "error":
        if (this.status === "connecting" || this.status === "waiting") {
          this.status = "error";
          this.error = msg.message;
          this.emit();
        }
        break;
    }
  }

  private async handleJoined(
    msg: Extract<ServerMessage, { type: "joined" }>
  ): Promise<void> {
    this.peerId = msg.peerId;
    this.role = msg.role;
    this.peers = msg.peers.map((p) => ({
      peerId: p.peerId,
      displayName: p.displayName,
      role: p.role,
      handRaised: p.handRaised,
      // 直接采用服务端快照：此前硬编码 false，只能等 newProducer / producerPaused /
      // peerRecording 等增量消息到达，期间会把所有人误显示为"未开麦、未录制"。
      camEnabled: p.camEnabled ?? false,
      micEnabled: p.micEnabled ?? false,
      recording: p.recording ?? false,
    }));
    const self = msg.peers.find((p) => p.peerId === msg.peerId);
    this.handRaised = self?.handRaised ?? false;
    // 共享权限同样取快照：否则主持人已关闭共享时，新入会者仍会看到可用的共享入口，
    // 点击后却被服务端以 share_not_allowed 拒绝。
    if (msg.allowShare !== undefined) {
      this.allowShare = msg.allowShare;
    }
    // 服务端能力：旧服务端无该字段 → false → 不发送屏幕共享音频轨（降级为无共享声音）
    this.serverSupportsScreenAudio = msg.capabilities?.screenAudio === true;
    this.canShare = msg.role === "host" || this.allowShare;
    if (msg.waitingRoomEnabled !== undefined) {
      this.waitingRoomEnabled = msg.waitingRoomEnabled;
    }
    if (msg.recordAllowed !== undefined) {
      this.recordAllowed = msg.recordAllowed;
    }
    // 同步房间当前布局/焦点：主持人已切演讲者/培训时，新入会者不应停留在宫格
    if (msg.layout !== undefined) {
      this.layout = msg.layout;
    }
    if (msg.focusPeerId !== undefined) {
      this.focusPeerId = msg.focusPeerId;
    }
    if (msg.rotationEnabled !== undefined) {
      this.rotationEnabled = msg.rotationEnabled;
    }
    this.status = "joined";
    this.emit();
    await this.setupMedia();
  }

  private async setupMedia(): Promise<void> {
    if (this.mediaReady || this.closed) return;

    const capsMsg = await this.request<
      Extract<ServerMessage, { type: "routerRtpCapabilities" }>
    >(
      { type: "getRouterRtpCapabilities" },
      (m) => m.type === "routerRtpCapabilities"
    );

    const device = new Device();
    await device.load({
      routerRtpCapabilities: capsMsg.rtpCapabilities as RtpCapabilities,
    });
    this.device = device;

    this.sendTransport = await this.createTransport("send");
    this.recvTransport = await this.createTransport("recv");

    // 浏览器仅在安全上下文（HTTPS 或 localhost）暴露 navigator.mediaDevices。
    // 以 http://<IP>:port 访问时该对象不存在，getUserMedia 会抛错并被上层吞掉，
    // 表现为"能进会议但看不到/听不到任何人"。这里提前判定并给出明确提示。
    if (typeof navigator.mediaDevices?.getUserMedia !== "function") {
      this.warning = "insecure_context";
      this.emit();
      return;
    }

    // —— 先开放消费通道，再采集本地媒体 ——
    // recv 传输已就绪：本地采集结果（有无摄像头/麦克风、是否授权）不应
    // 阻塞"看/听别人"。mediaReady 提前置位并冲刷排队的 newProducer；
    // 否则采集一旦失败，消费队列成为死信，表现为"进了会但看不到任何人"。
    this.mediaReady = true;
    this.startRttReporting();
    const queued = this.pendingProducers;
    this.pendingProducers = [];
    for (const m of queued) {
      void this.consumeProducer(m).catch((err) => {
        console.error("consume failed", err);
      });
    }

    const { stream, localMediaError } = await this.captureLocalStream();
    this.localMediaError = localMediaError;
    if (!stream) {
      // 纯观看模式：不创建任何本地 producer，本端以头像占位
      this.emit();
      return;
    }
    this.localStream = stream;
    this.watchLocalTracks(stream);

    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    if (audioTrack) {
      this.audioProducer = await this.sendTransport.produce({ track: audioTrack });
      if (!this.micEnabled) {
        this.audioProducer.pause();
        this.signal.send({
          type: "pauseProducer",
          producerId: this.audioProducer.id,
          paused: true,
        });
      }
    }

    if (videoTrack) {
      // 初始化时同步 track.enabled 与 camEnabled，确保 hasActiveCamera 判断正确
      videoTrack.enabled = this.camEnabled;
      this.videoProducer = await this.sendTransport.produce({
        track: videoTrack,
        encodings: VIDEO_ENCODINGS,
        codecOptions: { videoGoogleStartBitrate: 1000 },
      });
      if (!this.camEnabled) {
        this.videoProducer.pause();
        this.signal.send({
          type: "pauseProducer",
          producerId: this.videoProducer.id,
          paused: true,
        });
      }
    }

    this.emit();
  }

  /**
   * 分层降级采集本地媒体：
   * 1. 音视频一起采（设备齐全的正常路径）；
   * 2. 失败且非权限问题（无摄像头/设备占用/约束不满足）→ 仅采麦克风；
   * 3. 仅麦克风也失败 → 纯观看模式。
   * 返回 stream 为 null 时由调用方进入纯观看模式，错误码供 UI 非阻断提示。
   */
  private async captureLocalStream(): Promise<{
    stream: MediaStream | null;
    localMediaError: string | null;
  }> {
    const gUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const errName = (e: unknown): string => (e instanceof Error ? e.name : String(e));
    const isDenied = (name: string) =>
      name === "NotAllowedError" || name === "SecurityError";

    try {
      return {
        stream: await gUM({
          audio: true,
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        }),
        localMediaError: null,
      };
    } catch (err) {
      if (isDenied(errName(err))) {
        return { stream: null, localMediaError: "media_permission_denied" };
      }
      // 无摄像头 / 设备被占用 / 约束不满足 → 退到仅麦克风
      try {
        return {
          stream: await gUM({ audio: true, video: false }),
          localMediaError: "no_camera",
        };
      } catch (err2) {
        if (isDenied(errName(err2))) {
          return { stream: null, localMediaError: "media_permission_denied" };
        }
        const noDevice =
          errName(err) === "NotFoundError" || errName(err2) === "NotFoundError";
        return {
          stream: null,
          localMediaError: noDevice ? "no_media_devices" : "media_capture_failed",
        };
      }
    }
  }

  private async createTransport(direction: "send" | "recv"): Promise<Transport> {
    const created = await this.request<
      Extract<ServerMessage, { type: "transportCreated" }>
    >(
      { type: "createWebRtcTransport", direction },
      (m) => m.type === "transportCreated" && m.direction === direction
    );

    const device = this.device!;
    const transport =
      direction === "send"
        ? device.createSendTransport({
            id: created.id,
            iceParameters: created.iceParameters as never,
            iceCandidates: created.iceCandidates as never,
            dtlsParameters: created.dtlsParameters as never,
          })
        : device.createRecvTransport({
            id: created.id,
            iceParameters: created.iceParameters as never,
            iceCandidates: created.iceCandidates as never,
            dtlsParameters: created.dtlsParameters as never,
          });

    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      void (async () => {
        try {
          const reply = await this.request<
            | Extract<ServerMessage, { type: "transportConnected" }>
            | Extract<ServerMessage, { type: "error" }>
          >(
            {
              type: "connectWebRtcTransport",
              transportId: transport.id,
              dtlsParameters,
            },
            (m) =>
              (m.type === "transportConnected" &&
                m.transportId === transport.id) ||
              m.type === "error"
          );
          if (reply.type === "error") {
            throw new Error(reply.message);
          }
          callback();
        } catch (err) {
          errback(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });

    // 媒体面连通性监控：ICE/DTLS 失败时信令仍正常，若不上报用户只会看到
    // "看不到对方画面/听不到声音"而没有任何提示。典型原因：服务器
    // MEDIASOUP_ANNOUNCED_IP 配置错误或 UDP 40000-41000 未放行。
    transport.on("connectionstatechange", (state) => {
      // 诊断日志：完整状态轨迹（connected→disconnected→failed 的时间序列
      // 可区分网络抖动、NAT/UDP 映射超时与真正不可达）
      console.log(
        `[rtc] ${direction} transport connection state: ${state}`,
      );
      if (state === "failed") {
        void (async () => {
          // 自愈：ICE restart 换取新的 iceParameters 重新连通（容器/NAT 下
          // UDP 映射超时等瞬时故障常可恢复），不中断已建立的 produce/consume
          try {
            const reply = await this.request<
              | Extract<ServerMessage, { type: "iceRestarted" }>
              | Extract<ServerMessage, { type: "error" }>
            >(
              {
                type: "restartIce",
                transportId: transport.id,
              },
              (m) =>
                (m.type === "iceRestarted" &&
                  m.transportId === transport.id) ||
                m.type === "error",
            );
            if (reply.type === "error") throw new Error(reply.message);
            await transport.restartIce({
              iceParameters: reply.iceParameters as never,
            });
            console.log(`[rtc] ${direction} transport ICE restart issued`);
            return;
          } catch (err) {
            console.warn(
              `[rtc] ${direction} transport ICE restart failed:`,
              err instanceof Error ? err.message : err,
            );
          }
          // 自愈无效也保持静默（用户口径：媒体异常不进 UI），继续由
          // 后续状态事件驱动重试；运维排查依据见上方 console
        })();
      }
    });

    if (direction === "send") {
      transport.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        void (async () => {
          try {
            const reply = await this.request<
              | Extract<ServerMessage, { type: "produced" }>
              | Extract<ServerMessage, { type: "error" }>
            >(
              {
                type: "produce",
                transportId: transport.id,
                kind,
                rtpParameters,
                appData: appData as Record<string, unknown>,
              },
              (m) =>
                (m.type === "produced" && m.kind === kind) ||
                m.type === "error"
            );
            if (reply.type === "error") {
              throw new Error(reply.message);
            }
            callback({ id: reply.id });
          } catch (err) {
            errback(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      });
    }

    return transport;
  }

  private async consumeProducer(
    msg: Extract<ServerMessage, { type: "newProducer" }>
  ): Promise<void> {
    if (!this.device || !this.recvTransport || this.closed) {
      // 此前静默 return：媒体消费失败在界面上毫无痕迹，只能看到
      // "看不到对方画面/听不到声音"。改为显式报错，便于定位。
      console.error("[media] consume skipped: transport not ready", msg);
      this.setConsumeError("consume_not_ready");
      return;
    }

    let consumed:
      | Extract<ServerMessage, { type: "consumed" }>
      | Extract<ServerMessage, { type: "error" }>;
    try {
      consumed = await this.request<
        | Extract<ServerMessage, { type: "consumed" }>
        | Extract<ServerMessage, { type: "error" }>
      >(
        {
          type: "consume",
          producerId: msg.producerId,
          rtpCapabilities: this.device.rtpCapabilities,
        },
        // 同时匹配服务端 error，避免失败时静默等待 10s 超时
        (m) =>
          (m.type === "consumed" && m.producerId === msg.producerId) ||
          m.type === "error"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[media] consume request failed", message, msg);
      this.setConsumeError(message || "consume_failed");
      return;
    }
    if (consumed.type === "error") {
      console.error("[media] consume rejected by server", consumed.message);
      this.setConsumeError(consumed.message || "consume_failed");
      return;
    }

    const consumer = await this.recvTransport.consume({
      id: consumed.id,
      producerId: consumed.producerId,
      kind: consumed.kind,
      rtpParameters: consumed.rtpParameters as never,
    });

    // 竞态保护：consume 期间该 producer 已被关闭 → 丢弃本次消费，
    // 避免把已结束的流登记进 screenStreams/remoteStreams（后续无法移除）。
    if (this.closedProducerIds.has(consumed.producerId)) {
      try {
        consumer.close();
      } catch {
        /* ignore */
      }
      return;
    }

    this.consumers.set(consumer.id, consumer);

    // appData 透传的是 produce 时的原始值（音视频均为 source:"screen"），
    // 用 kind 区分：视频 → 共享画面；音频 → 共享内容声音（独立播放）
    const isScreen = msg.appData?.source === "screen" || consumed.appData?.source === "screen";
    const isScreenAudio = isScreen && consumer.kind === "audio";
    this.consumerMeta.set(consumer.id, {
      peerId: consumed.peerId,
      source: isScreen ? (isScreenAudio ? "screen-audio" : "screen") : "camera",
    });

    if (isScreenAudio) {
      let stream = this.screenAudioStreams.get(consumed.peerId);
      if (!stream) {
        stream = new MediaStream();
        this.screenAudioStreams.set(consumed.peerId, stream);
      }
      stream.addTrack(consumer.track);
    } else if (isScreen) {
      let stream = this.screenStreams.get(consumed.peerId);
      if (!stream) {
        stream = new MediaStream();
        this.screenStreams.set(consumed.peerId, stream);
      }
      stream.addTrack(consumer.track);
      this.screenFocusPeerId = consumed.peerId;
    } else {
      let stream = this.remoteStreams.get(consumed.peerId);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(consumed.peerId, stream);
      }
      stream.addTrack(consumer.track);
    }

    this.signal.send({ type: "resumeConsumer", consumerId: consumer.id });
    await consumer.resume();
    this.emit();
  }

  /** 记录媒体消费失败原因，界面可见（不打断会议，仅提示） */
  private setConsumeError(reason: string): void {
    this.warning = `consume_failed:${reason}`;
    this.emit();
  }

  private removeClosedProducer(producerId: string, peerId: string): void {
    this.closedProducerIds.add(producerId);
    this.pendingProducers = this.pendingProducers.filter(
      (p) => p.producerId !== producerId
    );

    for (const [id, consumer] of [...this.consumers]) {
      if (consumer.producerId !== producerId) continue;
      const meta = this.consumerMeta.get(id);
      try {
        consumer.close();
      } catch {
        /* ignore */
      }
      this.consumers.delete(id);
      this.consumerMeta.delete(id);

      const source = meta?.source ?? "camera";
      const map =
        source === "screen"
          ? this.screenStreams
          : source === "screen-audio"
            ? this.screenAudioStreams
            : this.remoteStreams;
      const stream = map.get(peerId);
      if (stream) {
        try {
          stream.removeTrack(consumer.track);
        } catch {
          /* ignore */
        }
        try {
          consumer.track.stop();
        } catch {
          /* ignore */
        }
        if (stream.getTracks().length === 0) {
          map.delete(peerId);
        }
      }
    }

    if (this.screenFocusPeerId === peerId && !this.screenStreams.has(peerId)) {
      this.screenFocusPeerId =
        this.screenStreams.size > 0
          ? [...this.screenStreams.keys()][0]!
          : this.sharingScreen
            ? this.peerId
            : null;
    }
  }

  private removeRemotePeer(peerId: string): void {
    for (const [id, meta] of [...this.consumerMeta]) {
      if (meta.peerId !== peerId) continue;
      const c = this.consumers.get(id);
      if (c) {
        try {
          c.close();
        } catch {
          /* ignore */
        }
        this.consumers.delete(id);
      }
      this.consumerMeta.delete(id);
    }

    const cam = this.remoteStreams.get(peerId);
    if (cam) {
      for (const t of cam.getTracks()) t.stop();
      this.remoteStreams.delete(peerId);
    }
    const screen = this.screenStreams.get(peerId);
    if (screen) {
      for (const t of screen.getTracks()) t.stop();
      this.screenStreams.delete(peerId);
    }
    if (this.screenFocusPeerId === peerId) {
      this.screenFocusPeerId =
        this.screenStreams.size > 0
          ? [...this.screenStreams.keys()][0]!
          : this.sharingScreen
            ? this.peerId
            : null;
    }
  }

  private cleanup(): void {
    this.closed = true;
    this.mediaReady = false;
    this.reconnecting = false;
    // 主动离开/会议结束：停掉 RTT 上报定时器（否则定时器持有实例引用造成累积泄漏）
    this.stopRttReporting();

    for (const c of this.consumers.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.consumers.clear();
    this.consumerMeta.clear();

    this.unwatchLocalTracks();
    for (const p of [this.audioProducer, this.videoProducer, this.screenProducer, this.screenAudioProducer]) {
      if (p && !p.closed) {
        try {
          p.close();
        } catch {
          /* ignore */
        }
      }
    }
    this.audioProducer = null;
    this.videoProducer = null;
    this.screenProducer = null;
    this.screenAudioProducer = null;
    this.screenAudioStreams.clear();
    this.sharingScreen = false;
    this.localMediaError = null;

    for (const t of [this.sendTransport, this.recvTransport]) {
      if (t && !t.closed) {
        try {
          t.close();
        } catch {
          /* ignore */
        }
      }
    }
    this.sendTransport = null;
    this.recvTransport = null;

    if (this.localStream) {
      for (const t of this.localStream.getTracks()) t.stop();
      this.localStream = null;
    }
    if (this.localScreenStream) {
      for (const t of this.localScreenStream.getTracks()) t.stop();
      this.localScreenStream = null;
    }
    for (const stream of this.remoteStreams.values()) {
      for (const t of stream.getTracks()) t.stop();
    }
    this.remoteStreams.clear();
    for (const stream of this.screenStreams.values()) {
      for (const t of stream.getTracks()) t.stop();
    }
    this.screenStreams.clear();
    this.screenFocusPeerId = null;
    this.closedProducerIds.clear();

    if (this.unsub) {
      this.unsub();
      this.unsub = null;
    }

    for (const entry of this.pending) {
      entry.reject(new Error("room_closed"));
    }
    this.pending = [];
  }
}
