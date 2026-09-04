import http from "node:http";
import { WebSocketServer } from "ws";
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

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  void signal.onConnection(ws);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`realtime listening on :${port}`);
});
