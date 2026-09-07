import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createPool } from "./db.js";
import { createSignalHandler } from "./signal.js";

const port = Number(process.env.WS_PORT ?? 8082);
const db = await createPool();
const signal = createSignalHandler(db);

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// maxPayload 限制单帧消息大小，防止恶意客户端撑爆内存。
// 正常信令（含 SDP/RTP 参数）远小于 1MB；聊天文本上限 2000 字符。
const wss = new WebSocketServer({ server, maxPayload: 1024 * 1024 });

type AliveWs = WebSocket & { isAlive?: boolean };

wss.on("connection", (ws) => {
  (ws as AliveWs).isAlive = true;
  ws.on("pong", () => {
    (ws as AliveWs).isAlive = true;
  });
  void signal.onConnection(ws);
});

// 心跳：周期性 ping，未响应的连接 terminate（清理幽灵连接，防止占满在线名额）
const HEARTBEAT_INTERVAL_MS = 30_000;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const alive = (ws as AliveWs).isAlive;
    if (alive === false) {
      ws.terminate();
      continue;
    }
    (ws as AliveWs).isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore closed socket */
    }
  }
}, HEARTBEAT_INTERVAL_MS);

server.listen(port, "0.0.0.0", () => {
  console.log(`realtime listening on :${port}`);
});

// ── 优雅停机：清理连接与资源后退出 ──
async function shutdown(sig: string) {
  console.log(`received ${sig}, shutting down`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try {
      ws.terminate();
    } catch {
      /* ignore */
    }
  }
  wss.close();
  server.close();
  try {
    await db.end();
  } catch {
    /* ignore */
  }
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
