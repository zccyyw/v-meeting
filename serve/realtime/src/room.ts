import type { UserRole } from "@meeting/shared";

export type Peer = {
  peerId: string;
  displayName: string;
  role: UserRole;
  inWaitingRoom: boolean;
  handRaised: boolean;
  canShare: boolean;
  /** 是否正在录制（内存态；随入会快照下发，供后入会者显示 REC 指示） */
  recording: boolean;
  /**
   * 入会时间（ms）：宫格排序依据（主持人第一、自己第二、其余按此正序）。
   * 非等候室直入者在 addPeer 时刻记录；等候室成员在准入（admit）时刻记录。
   * 重连换新连接即视为新成员重新计时（产品确认口径）。
   */
  joinedAt: number;
};

export class MeetingRoom {
  meetingId: string;
  waitingRoomEnabled: boolean;
  allowShareDefault: boolean;
  recordAllowed: boolean;
  layout: "grid" | "speaker" = "grid";
  focusPeerId: string | null = null;
  ended = false;
  private peers = new Map<string, Peer>();

  constructor(opts: {
    meetingId: string;
    waitingRoomEnabled: boolean;
    allowShareDefault: boolean;
    recordAllowed?: boolean;
  }) {
    this.meetingId = opts.meetingId;
    this.waitingRoomEnabled = opts.waitingRoomEnabled;
    this.allowShareDefault = opts.allowShareDefault;
    this.recordAllowed = opts.recordAllowed ?? false;
  }

  addPeer(input: { peerId: string; displayName: string; role: UserRole }): Peer {
    const inWaitingRoom =
      this.waitingRoomEnabled && input.role !== "host";
    const peer: Peer = {
      ...input,
      joinedAt: Date.now(),
      inWaitingRoom,
      handRaised: false,
      canShare: this.allowShareDefault || input.role === "host",
      recording: false,
    };
    this.peers.set(peer.peerId, peer);
    return peer;
  }

  getPeer(peerId: string) {
    return this.peers.get(peerId);
  }

  listAdmittedPeers() {
    return [...this.peers.values()].filter((p) => !p.inWaitingRoom);
  }

  listWaitingPeers() {
    return [...this.peers.values()].filter((p) => p.inWaitingRoom);
  }

  admit(peerId: string) {
    const p = this.peers.get(peerId);
    if (!p) return;
    // 等候室成员的"入会时间"以主持人准入时刻为准（非连接时刻）；
    // 非等候室路径不经过这里，时间戳已在 addPeer 记录。
    if (p.inWaitingRoom) p.joinedAt = Date.now();
    p.inWaitingRoom = false;
  }

  deny(peerId: string) {
    this.peers.delete(peerId);
  }

  remove(peerId: string) {
    this.peers.delete(peerId);
  }

  setSharePermission(allow: boolean) {
    this.allowShareDefault = allow;
    for (const p of this.peers.values()) {
      if (p.role !== "host") p.canShare = allow;
    }
  }

  setWaitingRoom(enabled: boolean) {
    this.waitingRoomEnabled = enabled;
  }

  setRecordAllowed(allowed: boolean) {
    this.recordAllowed = allowed;
  }
}
