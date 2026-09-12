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
  micEnabled: boolean;
  camEnabled: boolean;
  handRaised: boolean;
  layout: MeetingLayout;
  focusPeerId: string | null;
  sharingScreen: boolean;
  canShare: boolean;
  allowShare: boolean;
  waitingRoomEnabled: boolean;
  recordAllowed: boolean;
  chatMessages: ChatMessage[];
  error: string | null;
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
  private consumers = new Map<string, Consumer>();
  private consumerMeta = new Map<
    string,
    { peerId: string; source: "camera" | "screen" }
  >();
  private localStream: MediaStream | null = null;
  private localScreenStream: MediaStream | null = null;
  private remoteStreams = new Map<string, MediaStream>();
  private screenStreams = new Map<string, MediaStream>();
  private mediaReady = false;
  private closed = false;
  private pendingProducers: Extract<ServerMessage, { type: "newProducer" }>[] = [];
  /** 是否正在自动重连（防止并发触发多条重连流程） */
  private reconnecting = false;

  private status: MediaRoomStatus = "idle";
  private peerId: string | null = null;
  private role: UserRole | null = null;
  private waitingPeers: WaitingPeer[] = [];
  private peers: PeerInfo[] = [];
  private micEnabled = true;
  private camEnabled = false;
  private handRaised = false;
  private layout: MeetingLayout = "grid";
  private focusPeerId: string | null = null;
  private screenFocusPeerId: string | null = null;
  private sharingScreen = false;
  private canShare = true;
  private allowShare = true;
  private waitingRoomEnabled = false;
  private recordAllowed = false;
  private chatMessages: ChatMessage[] = [];
  private error: string | null = null;
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
      micEnabled: this.micEnabled,
      camEnabled: this.camEnabled,
      handRaised: this.handRaised,
      layout: this.layout,
      focusPeerId: this.screenFocusPeerId ?? this.focusPeerId,
      sharingScreen: this.sharingScreen,
      canShare: this.canShare,
      allowShare: this.allowShare,
      waitingRoomEnabled: this.waitingRoomEnabled,
      recordAllowed: this.recordAllowed,
      chatMessages: [...this.chatMessages],
      error: this.error,
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

  setLayout(layout: MeetingLayout): void {
    this.signal.send({ type: "setLayout", layout });
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
      if (this.videoProducer && !this.videoProducer.closed) {
        await this.videoProducer.replaceTrack({ track: next });
      }
    }
    this.emit();
  }

  async startScreenShare(): Promise<void> {
    if (!this.sendTransport || this.closed) return;
    if (!this.canShare) {
      this.error = "share_not_allowed";
      this.emit();
      return;
    }
    if (this.sharingScreen) return;

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });
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
      this.error =
        err instanceof Error ? err.message : "screen_share_failed";
      this.emit();
      return;
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
    const producerId = this.screenProducer?.id;
    if (this.screenProducer && !this.screenProducer.closed) {
      try {
        this.screenProducer.close();
      } catch {
        /* ignore */
      }
    }
    this.screenProducer = null;
    if (producerId) {
      try {
        this.signal.send({ type: "closeProducer", producerId });
      } catch {
        /* ignore */
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

    for (const p of [this.audioProducer, this.videoProducer, this.screenProducer]) {
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
    this.sharingScreen = false;

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
        if (msg.state === "failed" || msg.state === "disconnected") {
          this.error = "media_connection_failed";
          this.emit();
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
      camEnabled: false,
      micEnabled: false,
      recording: false,
    }));
    const self = msg.peers.find((p) => p.peerId === msg.peerId);
    this.handRaised = self?.handRaised ?? false;
    this.canShare = msg.role === "host" || this.allowShare;
    if (msg.waitingRoomEnabled !== undefined) {
      this.waitingRoomEnabled = msg.waitingRoomEnabled;
    }
    if (msg.recordAllowed !== undefined) {
      this.recordAllowed = msg.recordAllowed;
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

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.localStream = stream;

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

    this.mediaReady = true;
    const queued = this.pendingProducers;
    this.pendingProducers = [];
    for (const m of queued) {
      void this.consumeProducer(m).catch((err) => {
        console.error("consume failed", err);
      });
    }
    this.emit();
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
      if (state === "failed") {
        this.error = "media_connection_failed";
        this.emit();
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
    if (!this.device || !this.recvTransport || this.closed) return;

    const consumed = await this.request<
      Extract<ServerMessage, { type: "consumed" }>
    >(
      {
        type: "consume",
        producerId: msg.producerId,
        rtpCapabilities: this.device.rtpCapabilities,
      },
      (m) => m.type === "consumed" && m.producerId === msg.producerId
    );

    const consumer = await this.recvTransport.consume({
      id: consumed.id,
      producerId: consumed.producerId,
      kind: consumed.kind,
      rtpParameters: consumed.rtpParameters as never,
    });

    this.consumers.set(consumer.id, consumer);

    const isScreen = msg.appData?.source === "screen" || consumed.appData?.source === "screen";
    this.consumerMeta.set(consumer.id, {
      peerId: consumed.peerId,
      source: isScreen ? "screen" : "camera",
    });

    if (isScreen) {
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

  private removeClosedProducer(producerId: string, peerId: string): void {
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
      const map = source === "screen" ? this.screenStreams : this.remoteStreams;
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

    for (const c of this.consumers.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.consumers.clear();
    this.consumerMeta.clear();

    for (const p of [this.audioProducer, this.videoProducer, this.screenProducer]) {
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
    this.sharingScreen = false;

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
