// WS 信令冒烟测试 — 使用黑盒测试产出的主持人令牌
import WebSocket from "ws";
import { readFileSync } from "node:fs";

const ctx = JSON.parse(readFileSync(".test-data/ctx.json", "utf-8"));
const WS = "ws://127.0.0.1:8092/";
const results = [];
const check = (n, c, d = "") => { results.push(c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d && !c ? " ← " + d : ""}`); };

const ws = new WebSocket(WS);
const waiters = [];
let msgCount = 0;
const waitFor = (pred, timeout = 5000) =>
  new Promise((resolve) => {
    const w = { pred, resolve, timer: setTimeout(() => { w.done = true; resolve(null); }, timeout) };
    waiters.push(w);
  });

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  msgCount++;
  for (const w of waiters) {
    if (!w.done && w.pred(msg)) {
      w.done = true; clearTimeout(w.timer); w.resolve(msg);
    }
  }
});

const send = (m) => ws.send(JSON.stringify(m));

await new Promise((r) => (ws.on("open", r), ws.on("error", r)));

// F1 无 token join 被拒（独立连接，避免污染主连接状态）
{
  const bad = new WebSocket(WS);
  const badMsg = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 5000);
    bad.on("message", (raw) => {
      clearTimeout(t);
      resolve(JSON.parse(raw.toString()));
    });
    bad.on("close", () => { clearTimeout(t); resolve({ type: "closed" }); });
    bad.on("error", () => { clearTimeout(t); resolve({ type: "ws_error" }); });
    bad.on("open", () => bad.send(JSON.stringify({ type: "join", token: "invalid-token-xxx", displayName: "BB-Hacker" })));
  });
  check("F1 非法令牌 join 被拒绝", badMsg != null && ["error", "kicked", "closed"].includes(badMsg.type), JSON.stringify(badMsg));
  try { bad.close(); } catch {}
}

// F2 有效 token join 成功
send({ type: "join", token: ctx.hostJoinToken, displayName: "BB-主持人" });
const joined = await waitFor((m) => m.type === "joined");
check("F2 有效令牌 join 成功（joined 消息）",
  joined != null && joined.meetingId === String(ctx.meetingId) && joined.role === "host",
  JSON.stringify(joined)?.slice(0, 200));

// F3 router 能力获取（mediasoup 初始化正常）
send({ type: "getRouterRtpCapabilities" });
const caps = await waitFor((m) => m.type === "routerRtpCapabilities");
check("F3 mediasoup Router RTP 能力获取", caps != null && !!caps.rtpCapabilities?.codecs?.length,
  caps ? `codecs=${caps.rtpCapabilities?.codecs?.length}` : "timeout");

// F4 创建 send transport（mediasoup 工厂正常）
send({ type: "createWebRtcTransport", direction: "send" });
const tc = await waitFor((m) => m.type === "transportCreated");
check("F4 创建 WebRtc Transport", tc != null && !!tc.id && !!tc.iceParameters,
  JSON.stringify(tc)?.slice(0, 150));

// F5 举手广播
send({ type: "raiseHand", raised: true });
const hand = await waitFor((m) => m.type === "handRaised" && m.raised === true);
check("F5 举手事件广播", hand != null, "timeout");

// F6 聊天回显
send({ type: "chat", text: "blackbox-smoke-test" });
const chat = await waitFor((m) => m.type === "chat" && m.text === "blackbox-smoke-test");
check("F6 聊天消息广播", chat != null, "timeout");

// F7 主持人设置布局（需求 5 权限面）
send({ type: "setLayout", layout: "training" });
const layout = await waitFor((m) => m.type === "layout" && m.layout === "training");
check("F7 主持人设置培训布局广播", layout != null, "timeout");

// F8 离开清理
send({ type: "leave" });
await new Promise((r) => setTimeout(r, 800));
const before = msgCount;
await new Promise((r) => setTimeout(r, 500));
check("F8 离开后不再收到本会消息", msgCount === before, `before=${before} after=${msgCount}`);

ws.close();
console.log(`\nWS 冒烟: PASS ${results.filter(Boolean).length} / ${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
