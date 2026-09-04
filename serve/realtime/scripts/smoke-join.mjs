/**
 * Smoke: waiting room join/admit flows
 * 1) host first → guest waiting → host admit → guest joined
 * 2) guest first → host joins → host receives waiting snapshot
 * Usage: node services/realtime/scripts/smoke-join.mjs
 */
import WebSocket from "ws";

const API = process.env.API_BASE ?? "http://127.0.0.1:8080";
const WS = process.env.WS_URL ?? "ws://127.0.0.1:8082";

function onceMessage(ws, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    const onMsg = (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (predicate(msg)) {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
  });
}

async function api(path, init = {}) {
  const headers = { "content-type": "application/json", ...(init.headers ?? {}) };
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return body;
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function createMeeting(label) {
  const user = `smoke_${label}_${Date.now()}`;
  const reg = await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      username: user,
      password: "pass1234",
      displayName: "SmokeHost",
    }),
  });
  const sessionId = reg.sessionId;
  const meeting = await api("/meetings", {
    method: "POST",
    headers: { "x-session-id": sessionId },
    body: JSON.stringify({ title: `Smoke Join ${label}`, waitingRoomEnabled: true }),
  });
  const guest = await api(`/meetings/${meeting.id}/guest-token`, {
    method: "POST",
    body: JSON.stringify({ displayName: "SmokeGuest" }),
  });
  return { meeting, guest };
}

async function caseHostFirstThenAdmit() {
  console.log("--- case: host first, then guest waiting, admit ---");
  const { meeting, guest } = await createMeeting("host_first");

  const hostWs = await connect();
  const guestWs = await connect();

  const hostJoinedP = onceMessage(hostWs, (m) => m.type === "joined" || m.type === "error");
  hostWs.send(
    JSON.stringify({
      type: "join",
      token: meeting.hostJoinToken,
      displayName: "SmokeHost",
    })
  );
  const hostJoined = await hostJoinedP;
  if (hostJoined.type !== "joined") throw new Error(`host expected joined, got ${JSON.stringify(hostJoined)}`);
  console.log("host joined", hostJoined.peerId);

  const guestWaitingP = onceMessage(guestWs, (m) => m.type === "waiting" || m.type === "error");
  const hostSawWaitingP = onceMessage(hostWs, (m) => m.type === "waiting");
  guestWs.send(
    JSON.stringify({
      type: "join",
      token: guest.token,
      displayName: "Guest",
    })
  );
  const guestWaiting = await guestWaitingP;
  if (guestWaiting.type !== "waiting") {
    throw new Error(`guest expected waiting, got ${JSON.stringify(guestWaiting)}`);
  }
  if (guestWaiting.displayName !== "SmokeGuest") {
    throw new Error(
      `guest waiting displayName expected SmokeGuest (from auth), got ${guestWaiting.displayName}`
    );
  }
  console.log("guest waiting", guestWaiting.peerId, guestWaiting.displayName);

  const hostSawWaiting = await hostSawWaitingP;
  console.log("host notified waiting", hostSawWaiting.peerId, hostSawWaiting.displayName);
  if (hostSawWaiting.displayName !== "SmokeGuest") {
    throw new Error(
      `host waiting displayName expected SmokeGuest, got ${hostSawWaiting.displayName}`
    );
  }

  const guestJoinedP = onceMessage(guestWs, (m) => m.type === "joined" || m.type === "error");
  const hostSawPeerP = onceMessage(
    hostWs,
    (m) => m.type === "peerJoined" && m.peerId === guestWaiting.peerId
  );
  hostWs.send(
    JSON.stringify({
      type: "host",
      action: "admit",
      targetPeerId: guestWaiting.peerId,
    })
  );

  const guestJoined = await guestJoinedP;
  if (guestJoined.type !== "joined") {
    throw new Error(`guest expected joined after admit, got ${JSON.stringify(guestJoined)}`);
  }
  console.log("guest joined after admit", guestJoined.peerId, "peers", guestJoined.peers?.length);

  const hostSawPeer = await hostSawPeerP;
  console.log("host saw peerJoined", hostSawPeer.displayName);

  hostWs.close();
  guestWs.close();
}

async function caseGuestFirstThenHostSeesWaiting() {
  console.log("--- case: guest first, then host receives waiting snapshot ---");
  const { meeting, guest } = await createMeeting("guest_first");

  const guestWs = await connect();
  const guestWaitingP = onceMessage(guestWs, (m) => m.type === "waiting" || m.type === "error");
  guestWs.send(
    JSON.stringify({
      type: "join",
      token: guest.token,
      displayName: "Guest",
    })
  );
  const guestWaiting = await guestWaitingP;
  if (guestWaiting.type !== "waiting") {
    throw new Error(`guest expected waiting, got ${JSON.stringify(guestWaiting)}`);
  }
  if (guestWaiting.displayName !== "SmokeGuest") {
    throw new Error(
      `guest waiting displayName expected SmokeGuest (from auth), got ${guestWaiting.displayName}`
    );
  }
  console.log("guest waiting first", guestWaiting.peerId, guestWaiting.displayName);

  const hostWs = await connect();
  const hostJoinedP = onceMessage(hostWs, (m) => m.type === "joined" || m.type === "error");
  const hostSawWaitingP = onceMessage(
    hostWs,
    (m) => m.type === "waiting" && m.peerId === guestWaiting.peerId
  );
  hostWs.send(
    JSON.stringify({
      type: "join",
      token: meeting.hostJoinToken,
      displayName: "SmokeHost",
    })
  );
  const hostJoined = await hostJoinedP;
  if (hostJoined.type !== "joined") {
    throw new Error(`host expected joined, got ${JSON.stringify(hostJoined)}`);
  }
  console.log("host joined after guest", hostJoined.peerId);

  const hostSawWaiting = await hostSawWaitingP;
  console.log(
    "host received waiting snapshot",
    hostSawWaiting.peerId,
    hostSawWaiting.displayName
  );
  if (hostSawWaiting.displayName !== "SmokeGuest") {
    throw new Error(
      `host waiting snapshot displayName expected SmokeGuest, got ${hostSawWaiting.displayName}`
    );
  }

  hostWs.close();
  guestWs.close();
}

await caseHostFirstThenAdmit();
await caseGuestFirstThenHostSeesWaiting();
console.log("SMOKE OK");
process.exit(0);
