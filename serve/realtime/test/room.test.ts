import { describe, it, expect } from "vitest";
import { MeetingRoom } from "../src/room.js";

describe("MeetingRoom waiting room", () => {
  it("keeps non-host in waiting when enabled", () => {
    const room = new MeetingRoom({
      meetingId: "m1",
      waitingRoomEnabled: true,
      allowShareDefault: true,
    });
    const host = room.addPeer({
      peerId: "h1",
      displayName: "Host",
      role: "host",
    });
    expect(host.inWaitingRoom).toBe(false);

    const guest = room.addPeer({
      peerId: "g1",
      displayName: "G",
      role: "guest",
    });
    expect(guest.inWaitingRoom).toBe(true);

    room.admit("g1");
    expect(room.getPeer("g1")?.inWaitingRoom).toBe(false);
  });

  it("listWaitingPeers returns only waiting peers", () => {
    const room = new MeetingRoom({
      meetingId: "m1",
      waitingRoomEnabled: true,
      allowShareDefault: true,
    });
    room.addPeer({ peerId: "h1", displayName: "Host", role: "host" });
    room.addPeer({ peerId: "g1", displayName: "G1", role: "guest" });
    room.addPeer({ peerId: "g2", displayName: "G2", role: "guest" });
    room.admit("g1");

    const waiting = room.listWaitingPeers();
    expect(waiting.map((p) => p.peerId)).toEqual(["g2"]);
    expect(room.listAdmittedPeers().map((p) => p.peerId).sort()).toEqual([
      "g1",
      "h1",
    ]);
  });
});
