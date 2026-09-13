// 黑盒多人会议功能测试 — 基于 test1-5 账号（密码 123456）
// 前置：独立测试栈已启动（api:8090 / realtime:8092），且已 SEED_TEST_USERS=1 seed
// 用法：node scripts/blackbox-meeting.mjs
import WebSocket from "ws";

const API = "http://127.0.0.1:8090";
const WS = "ws://127.0.0.1:8092/";
const KEY = process.env.MEETING_CRYPTO_KEY || "rEWjZY3aMFivxEApHkEw7GMHZC3uR2QGUio7w0NYdZ0";
const enc = new TextEncoder();

// ── 工具 ──
async function getKey() {
  const arr = new Uint8Array(32);
  const src = enc.encode(KEY);
  for (let i = 0; i < 32; i++) arr[i] = src[i % src.length] ?? 0;
  return crypto.subtle.importKey("raw", arr, { name: "AES-GCM" }, false, ["encrypt"]);
}
async function encryptPassword(plain) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  return `enc:${b64(iv)}:${b64(ct)}`;
}
async function req(method, path, { sid, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "content-type": "application/json", ...(sid ? { "x-session-id": sid } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const results = [];
function check(name, cond, detail = "") {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  ← " + detail : ""}`);
}

/**
 * 单个会议客户端：WS 连接 + 消息等待器。
 * waitFor 支持扫描历史消息（afterIndex 之前跳过），避免"消息早于等待器到达"的竞态。
 */
class Peer {
  constructor(name) {
    this.name = name;
    this.peerId = null;
    this.role = null;
    this.messages = [];
    this.waiters = [];
    this.ws = new WebSocket(WS);
    this.ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      this.messages.push(msg);
      for (const w of this.waiters) {
        if (!w.done && w.pred(msg) && this.messages.length - 1 >= w.afterIndex) {
          w.done = true; clearTimeout(w.timer); w.resolve(msg);
        }
      }
    });
    this.opened = new Promise((r) => this.ws.on("open", r));
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  /** 等待满足条件的消息；afterIndex 之后才算（默认 0=可匹配历史） */
  waitFor(pred, timeout = 8000, afterIndex = 0) {
    const existing = this.messages.findIndex((m, i) => i >= afterIndex && pred(m));
    if (existing >= 0) return Promise.resolve(this.messages[existing]);
    return new Promise((resolve) => {
      const w = { pred, resolve, done: false, afterIndex, timer: setTimeout(() => { w.done = true; resolve(null); }, timeout) };
      this.waiters.push(w);
    });
  }
  /** 当前消息数量（用作位标） */
  mark() { return this.messages.length; }
  /** 位标之后是否出现过满足条件的消息 */
  hasSince(markIndex, pred) {
    return this.messages.slice(markIndex).some(pred);
  }
  close() { try { this.ws.close(); } catch {} }
}

// ── 媒体信令用的合法构造参数 ──
function fakeDtls() {
  const hex = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");
  return { role: "client", fingerprints: [{ algorithm: "sha-256", value: hex }] };
}
const audioRtp = (ssrc) => ({
  mid: "0",
  codecs: [{ mimeType: "audio/opus", payloadType: 111, clockRate: 48000, channels: 2, parameters: {}, rtcpFeedback: [] }],
  headerExtensions: [],
  encodings: [{ ssrc }],
  rtcp: { cname: "bb-" + ssrc, reducedSize: true },
});
const videoRtp = (ssrc) => ({
  mid: "1",
  codecs: [{ mimeType: "video/VP8", payloadType: 96, clockRate: 90000, parameters: {}, rtcpFeedback: [] }],
  headerExtensions: [],
  encodings: [{ ssrc }],
  rtcp: { cname: "bb-" + ssrc, reducedSize: true },
});

// ══════════ 1. 登录 test1-5 & 创建会议 ══════════
console.log("[1] 登录 test1-5 并创建会议…");
const sids = {};
for (const u of ["test1", "test2", "test3", "test4", "test5"]) {
  const r = await req("POST", "/auth/login", { body: { username: u, password: await encryptPassword("123456") } });
  if (r.status !== 200) { console.error(`登录失败: ${u}`, r.json); process.exit(1); }
  sids[u] = r.json.sessionId;
}
check("M0 五个测试账号全部登录成功", Object.keys(sids).length === 5);

const created = await req("POST", "/meetings", { sid: sids.test1, body: { title: "黑盒-多人会议" } });
check("M0b test1 创建快速会议", created.status === 200 && !!created.json.hostJoinToken, JSON.stringify(created.json).slice(0, 200));
const meetingId = created.json.id;

const tokens = { test1: created.json.hostJoinToken };
for (const u of ["test2", "test3", "test4", "test5"]) {
  const r = await req("POST", `/meetings/${meetingId}/join-token`, { sid: sids[u], body: {} });
  if (r.status !== 200 || !r.json.token) { console.error(`join-token 失败 ${u}:`, r.status, r.json); process.exit(1); }
  tokens[u] = r.json.token;
}
check("M0c test2-5 均获取到入会令牌", Object.values(tokens).every(Boolean));

// ══════════ 2. 五人入会 ══════════
console.log("[2] 五人入会…");
const peers = {};
for (const u of ["test1", "test2", "test3", "test4", "test5"]) {
  const p = new Peer(u);
  await p.opened;
  p.send({ type: "join", token: tokens[u], displayName: u });
  peers[u] = p;
}
const joined1 = await peers.test1.waitFor((m) => m.type === "joined");
check("M1 主持人 test1 入会（role=host）", joined1 != null && joined1.role === "host", JSON.stringify(joined1)?.slice(0, 150));
peers.test1.peerId = joined1?.peerId;
peers.test1.role = joined1?.role;

for (const u of ["test2", "test3", "test4", "test5"]) {
  const j = await peers[u].waitFor((m) => m.type === "joined");
  peers[u].peerId = j?.peerId;
  peers[u].role = j?.role;
}
check("M1b test2-5 全部入会（role=participant）且 peerId 齐全",
  ["test2", "test3", "test4", "test5"].every((u) => peers[u].role === "participant" && !!peers[u].peerId));

// peerJoined 与 joiner 的 joined 走不同连接，最后一条可能仍在途：轮询等待
let pjCount = 0;
for (let i = 0; i < 20; i++) {
  pjCount = peers.test1.messages.filter((m) => m.type === "peerJoined").length;
  if (pjCount >= 4) break;
  await new Promise((r) => setTimeout(r, 300));
}
check("M2 主持人收到 4 条 peerJoined 广播", pjCount === 4, `got=${pjCount}`);

// ══════════ 3. 媒体信令：caps / transport / connect ══════════
console.log("[3] 媒体信令（Router 能力 + 双向 Transport + DTLS connect）…");
const capsMap = {};
for (const u of Object.keys(peers)) {
  peers[u].send({ type: "getRouterRtpCapabilities" });
  const caps = await peers[u].waitFor((m) => m.type === "routerRtpCapabilities");
  capsMap[u] = caps?.rtpCapabilities;
}
check("M3 五人均获取 Router RTP 能力（opus/VP8/H264）",
  Object.values(capsMap).every((c) => c?.codecs?.some((x) => x.mimeType === "audio/opus")
    && c?.codecs?.some((x) => x.mimeType === "video/VP8")));

for (const u of Object.keys(peers)) {
  for (const dir of ["send", "recv"]) {
    peers[u].send({ type: "createWebRtcTransport", direction: dir });
    const t = await peers[u].waitFor((m) => m.type === "transportCreated" && m.direction === dir);
    peers[u][dir + "Id"] = t?.id;
    peers[u][dir + "Candidates"] = t?.iceCandidates;
  }
}
check("M4 五人 × send/recv 传输全部创建（含 ICE 候选）",
  Object.keys(peers).every((u) => peers[u].sendId && peers[u].recvId
    && peers[u].sendCandidates?.length > 0 && peers[u].recvCandidates?.length > 0));

for (const u of Object.keys(peers)) {
  for (const dir of ["send", "recv"]) {
    peers[u].send({ type: "connectWebRtcTransport", transportId: peers[u][dir + "Id"], dtlsParameters: fakeDtls() });
    const ok = await peers[u].waitFor((m) => (m.type === "transportConnected" && m.transportId === peers[u][dir + "Id"]) || m.type === "error");
    if (ok?.type === "error") console.log(`  [warn] ${u} ${dir} connect error: ${ok.message}`);
  }
}
check("M4b 五人 × 双向传输 DTLS connect 完成",
  Object.keys(peers).every((u) => peers[u].messages.some((m) => m.type === "transportConnected" && m.transportId === peers[u].sendId)
    && peers[u].messages.some((m) => m.type === "transportConnected" && m.transportId === peers[u].recvId)));

// ══════════ 4. produce：test1/test2 各发布 音频+视频 ══════════
console.log("[4] 音视频发布（produce）与广播（newProducer）…");
let ssrc = 4820000;
const producersByUser = {};
for (const u of ["test1", "test2"]) {
  producersByUser[u] = {};
  for (const kind of ["audio", "video"]) {
    const rp = kind === "audio" ? audioRtp(++ssrc) : videoRtp(++ssrc);
    peers[u].send({ type: "produce", transportId: peers[u].sendId, kind, rtpParameters: rp, appData: {} });
    const ack = await peers[u].waitFor((m) => (m.type === "produced" && m.kind === kind) || m.type === "error");
    if (ack?.type === "error") console.log(`  [warn] ${u} ${kind} produce error: ${ack.message}`);
    producersByUser[u][kind] = ack?.id ?? null;
  }
}
check("M5 test1/test2 各成功发布 音频+视频（4 个 producer）",
  ["test1", "test2"].every((u) => producersByUser[u].audio && producersByUser[u].video));

// 等待广播到达（非发布者各 4 条）
for (const u of ["test3", "test4", "test5"]) {
  await peers[u].waitFor(() => false, 300); // 让消息自然到达
  let waited = 0;
  while (peers[u].messages.filter((m) => m.type === "newProducer").length < 4 && waited < 6000) {
    await new Promise((r) => setTimeout(r, 300)); waited += 300;
  }
}
check("M5b 非发布者每人收到 4 条 newProducer 广播",
  ["test3", "test4", "test5"].every((u) => peers[u].messages.filter((m) => m.type === "newProducer").length >= 4));

// ══════════ 5. consume：test3/4/5 消费全部 4 个 producer ══════════
console.log("[5] 音视频消费（consume → resumeConsumer）…");
let consumeOk = 0;
for (const u of ["test3", "test4", "test5"]) {
  const allProducers = ["test1", "test2"].flatMap((o) => ["audio", "video"].map((k) => producersByUser[o][k]));
  for (const pid of allProducers) {
    const mk = peers[u].mark();
    peers[u].send({ type: "consume", producerId: pid, rtpCapabilities: capsMap[u] });
    const c = await peers[u].waitFor((m) => (m.type === "consumed" && m.producerId === pid) || m.type === "error", 8000, mk);
    if (c?.type === "consumed") {
      consumeOk += 1;
      const mk2 = peers[u].mark();
      peers[u].send({ type: "resumeConsumer", consumerId: c.id });
      const err = await peers[u].waitFor((m) => m.type === "error", 1500, mk2);
      if (err) console.log(`  [warn] ${u} resumeConsumer error: ${err.message}`);
    } else if (c) {
      console.log(`  [warn] ${u} consume ${pid?.slice(0, 8)} error: ${c.message}`);
    }
  }
}
check("M6 test3/4/5 各消费 4 路（共 12 路 consumer）", consumeOk === 12, `ok=${consumeOk}/12`);

// ══════════ 6. 主持人管控 ══════════
console.log("[6] 主持人管控（全体/单个 静音与解除）…");
{
  const marks = {};
  for (const u of ["test1", "test2", "test3", "test4", "test5"]) marks[u] = peers[u].mark();
  peers.test1.send({ type: "host", action: "muteAll" });
  const results = await Promise.all(["test2", "test3", "test4", "test5"]
    .map((u) => peers[u].waitFor((m) => m.type === "forceMute" && m.audio === true, 8000, marks[u])));
  await new Promise((r) => setTimeout(r, 1200));
  const hostGot = peers.test1.hasSince(marks.test1, (m) => m.type === "forceMute");
  check("M7 全体静音：4 名成员均收到 forceMute(audio=true)，主持人不收",
    results.every(Boolean) && !hostGot, `members=${results.map(Boolean)} hostGot=${hostGot}`);
}
{
  const marks = {};
  for (const u of ["test2", "test3", "test4", "test5"]) marks[u] = peers[u].mark();
  peers.test1.send({ type: "host", action: "unmuteAll" });
  const results = await Promise.all(["test2", "test3", "test4", "test5"]
    .map((u) => peers[u].waitFor((m) => m.type === "forceMute" && m.audio === false, 8000, marks[u])));
  check("M8 解除全体静音：4 名成员均收到 forceMute(audio=false)", results.every(Boolean));
}
{
  const marks = {};
  for (const u of ["test1", "test2", "test3", "test4"]) marks[u] = peers[u].mark();
  peers.test1.send({ type: "host", action: "mutePeer", targetPeerId: peers.test2.peerId });
  const t2 = await peers.test2.waitFor((m) => m.type === "forceMute" && m.audio === true, 8000, marks.test2);
  await new Promise((r) => setTimeout(r, 1200));
  const leaked = ["test3", "test4"].filter((u) => peers[u].hasSince(marks[u], (m) => m.type === "forceMute"));
  check("M9 单成员静音：仅 test2 收到 forceMute，无泄漏", t2 != null && leaked.length === 0,
    `t2=${!!t2} leaked=${leaked}`);
}
{
  const marks = {};
  for (const u of ["test2", "test3", "test4"]) marks[u] = peers[u].mark();
  peers.test1.send({ type: "host", action: "unmutePeer", targetPeerId: peers.test2.peerId });
  const t2 = await peers.test2.waitFor((m) => m.type === "forceMute" && m.audio === false, 8000, marks.test2);
  await new Promise((r) => setTimeout(r, 1200));
  const leaked = ["test3", "test4"].filter((u) => peers[u].hasSince(marks[u], (m) => m.type === "forceMute"));
  check("M10 单成员解除静音（新功能）：仅 test2 收到 forceMute(audio=false)，无泄漏",
    t2 != null && leaked.length === 0, `t2=${!!t2} leaked=${leaked}`);
}

// ══════════ 7. 互动：举手 / 聊天 / 布局 ══════════
console.log("[7] 互动（举手/聊天/布局）…");
{
  const marks = {};
  for (const u of ["test1", "test2", "test4", "test5"]) marks[u] = peers[u].mark();
  peers.test3.send({ type: "raiseHand", raised: true });
  const others = await Promise.all(["test1", "test2", "test4", "test5"]
    .map((u) => peers[u].waitFor((m) => m.type === "handRaised" && m.peerId === peers.test3.peerId && m.raised === true, 8000, marks[u])));
  check("M11 举手广播到其他 4 人", others.every(Boolean));
}
{
  const marks = {};
  for (const u of ["test1", "test2", "test3", "test5"]) marks[u] = peers[u].mark();
  peers.test4.send({ type: "chat", text: "黑盒测试消息-多人会议" });
  const others = await Promise.all(["test1", "test2", "test3", "test5"]
    .map((u) => peers[u].waitFor((m) => m.type === "chat" && m.text === "黑盒测试消息-多人会议", 8000, marks[u])));
  check("M12 聊天广播到其他 4 人（含发送者昵称）", others.every((o) => o && o.displayName === "test4"));
}
{
  const marks = {};
  for (const u of ["test2", "test3", "test4", "test5"]) marks[u] = peers[u].mark();
  peers.test1.send({ type: "setLayout", layout: "training" });
  const others = await Promise.all(["test2", "test3", "test4", "test5"]
    .map((u) => peers[u].waitFor((m) => m.type === "layout" && m.layout === "training", 8000, marks[u])));
  check("M13 主持人切换培训布局广播", others.every(Boolean));
}

// ══════════ 8. 移出成员 ══════════
console.log("[8] 移出成员…");
{
  const marks = {};
  for (const u of ["test2", "test4", "test5"]) marks[u] = peers[u].mark();
  const mk3 = peers.test3.mark();
  peers.test1.send({ type: "host", action: "kick", targetPeerId: peers.test3.peerId });
  const t3 = await peers.test3.waitFor((m) => m.type === "kicked", 8000, mk3);
  const others = await Promise.all(["test2", "test4", "test5"]
    .map((u) => peers[u].waitFor((m) => m.type === "peerLeft" && m.peerId === peers.test3.peerId, 8000, marks[u])));
  check("M14 移出：test3 收到 kicked，其他人收到 peerLeft", t3 != null && others.every(Boolean));
}

// ══════════ 9. 等候室 ══════════
console.log("[9] 等候室（开等候室 → 重进 → 准入 + producer 重放）…");
{
  const mk2 = peers.test2.mark();
  peers.test1.send({ type: "host", action: "setWaitingRoom", waitingRoomEnabled: true });
  await peers.test2.waitFor((m) => m.type === "waitingRoomChanged" && m.enabled === true, 8000, mk2);

  peers.test5.send({ type: "leave" });
  await new Promise((r) => setTimeout(r, 500));
  peers.test5.close();
  const p5 = new Peer("test5-again");
  await p5.opened;
  const mkHost = peers.test1.mark();
  p5.send({ type: "join", token: tokens.test5, displayName: "test5" });
  const waitingMsg = await peers.test1.waitFor((m) => m.type === "waiting" && m.displayName === "test5", 8000, mkHost);
  check("M15 开启等候室后重新入会进入等候（主持人收到 waiting）", waitingMsg != null);

  peers.test1.send({ type: "host", action: "admit", targetPeerId: waitingMsg.peerId });
  const joined5 = await p5.waitFor((m) => m.type === "joined");
  let waited = 0;
  while (p5.messages.filter((m) => m.type === "newProducer").length < 4 && waited < 6000) {
    await new Promise((r) => setTimeout(r, 300)); waited += 300;
  }
  const replay = p5.messages.filter((m) => m.type === "newProducer").length;
  check("M16 准入后收到 joined 与 4 路 producer 重放（可继续消费音视频）",
    joined5 != null && replay === 4, `joined=${!!joined5} replay=${replay}/4`);
  peers.test5 = p5;
}

// ══════════ 10. 结束会议 ══════════
console.log("[10] 结束会议…");
{
  const marks = {};
  for (const u of ["test2", "test4", "test5"]) marks[u] = peers[u].mark();
  peers.test1.send({ type: "host", action: "endMeeting" });
  const ends = await Promise.all([peers.test2, peers.test4, peers.test5]
    .map((p, i) => p.waitFor((m) => m.type === "meetingEnded", 8000, marks[["test2", "test4", "test5"][i]])));
  check("M17 结束会议广播到全部在线成员", ends.every(Boolean));
}
const after = await req("POST", `/meetings/${meetingId}/join-token`, { sid: sids.test2, body: {} });
check("M18 结束后不可再获取入会令牌（409 ended）", after.status === 409 || after.json?.error === "ended",
  `status=${after.status} ${JSON.stringify(after.json).slice(0, 120)}`);
const detail = await req("GET", `/meetings/${meetingId}`, { sid: sids.test1 });
check("M19 会议状态已置为 ended", detail.json?.status === "ended", JSON.stringify(detail.json).slice(0, 120));

for (const p of Object.values(peers)) p.close();

// ══════════ 汇总 ══════════
console.log("\n══════════ 多人会议黑盒测试汇总 ══════════");
const pass = results.filter((r) => r.ok).length;
console.log(`PASS ${pass} / ${results.length}`);
const failed = results.filter((r) => !r.ok);
if (failed.length) { console.log("FAILED:"); failed.forEach((f) => console.log("  -", f.name)); }
process.exit(failed.length ? 1 : 0);
