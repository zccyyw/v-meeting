import type { UserRole } from "@meeting/shared";

export type Peer = {
  peerId: string;
  displayName: string;
  role: UserRole;
  inWaitingRoom: boolean;
  handRaised: boolean;
  canShare: boolean;
};

export class MeetingRoom {
  meetingId: string;
  waitingRoomEnabled: boolean;
  allowShareDefault: boolean;
  recordAllowed: boolean;
  layout: "grid" | "speaker" | "training" = "grid";
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
      inWaitingRoom,
      handRaised: false,
      canShare: this.allowShareDefault || input.role === "host",
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
    if (p) p.inWaitingRoom = false;
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
