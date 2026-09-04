#!/usr/bin/env node
/**
 * Lightweight edge: static front + /api proxy + /ws upgrade proxy.
 * Supports both HTTP and HTTPS (auto-detects certs).
 *
 * Env: FRONT_ROOT, API_UPSTREAM, WS_UPSTREAM, GATEWAY_PORT,
 *      CERT_DIR (optional, e.g. /opt/meeting/certs — enables HTTPS)
 */
import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONT_ROOT = process.env.FRONT_ROOT
  ? path.resolve(process.env.FRONT_ROOT)
  : path.resolve(__dirname, "../app/front");
const API_UPSTREAM = process.env.API_UPSTREAM || "http://127.0.0.1:8080";
const WS_UPSTREAM = process.env.WS_UPSTREAM || "http://127.0.0.1:8082";
const PORT = Number(process.env.GATEWAY_PORT || 8088);

// --- HTTPS support: auto-detect certs in CERT_DIR or ../certs ---
const certDir = process.env.CERT_DIR
  ? path.resolve(process.env.CERT_DIR)
  : path.resolve(__dirname, "../certs");
const certFile = path.join(certDir, "fullchain.pem");
const keyFile = path.join(certDir, "privkey.pem");
const useHttps = fs.existsSync(certFile) && fs.existsSync(keyFile);
const sslOptions = useHttps
  ? { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }
  : null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function parseUpstream(url) {
  const u = new URL(url);
  return {
    hostname: u.hostname,
    port: u.port || (u.protocol === "https:" ? 443 : 80),
    protocol: u.protocol,
  };
}

const apiUp = parseUpstream(API_UPSTREAM);
const wsUp = parseUpstream(WS_UPSTREAM);

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  const headers = { "Content-Type": type, "Content-Length": data.length };
  if (ext === ".html" || filePath.endsWith("sw.js") || filePath.endsWith("manifest.webmanifest")) {
    headers["Cache-Control"] = "no-cache";
  }
  res.writeHead(200, headers);
  res.end(data);
}

function safeJoin(root, reqPath) {
  const decoded = decodeURIComponent(reqPath.split("?")[0] || "/");
  const cleaned = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(root, cleaned);
  if (!full.startsWith(root)) return null;
  return full;
}

function proxyHttp(req, res) {
  const url = new URL(req.url || "/", "http://gateway.local");
  let targetPath = url.pathname + url.search;
  if (targetPath.startsWith("/api")) {
    targetPath = targetPath.slice("/api".length) || "/";
  }
  const headers = { ...req.headers, host: `${apiUp.hostname}:${apiUp.port}` };
  const preq = http.request(
    {
      hostname: apiUp.hostname,
      port: apiUp.port,
      path: targetPath,
      method: req.method,
      headers,
    },
    (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    },
  );
  preq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`Bad gateway (api): ${err.message}`);
  });
  req.pipe(preq);
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://gateway.local");
  let filePath = safeJoin(FRONT_ROOT, url.pathname === "/" ? "/index.html" : url.pathname);
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    // SPA fallback
    const index = path.join(FRONT_ROOT, "index.html");
    if (fs.existsSync(index)) {
      sendFile(res, index);
      return;
    }
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  sendFile(res, filePath);
}

function handleRequest(req, res) {
  const url = req.url || "/";
  if (url === "/api/healthz" || url.startsWith("/api/") || url === "/api") {
    proxyHttp(req, res);
    return;
  }
  serveStatic(req, res);
}

function handleUpgrade(req, socket, head) {
  const url = req.url || "/";
  if (!(url === "/ws" || url.startsWith("/ws?") || url.startsWith("/ws/"))) {
    socket.destroy();
    return;
  }
  const headers = { ...req.headers, host: `${wsUp.hostname}:${wsUp.port}` };
  const preq = http.request({
    hostname: wsUp.hostname,
    port: wsUp.port,
    path: "/",
    method: "GET",
    headers,
  });
  preq.on("upgrade", (pres, psocket, phead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(pres.headers)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
          .join("\r\n") +
        "\r\n\r\n",
    );
    if (phead?.length) socket.write(phead);
    psocket.pipe(socket);
    socket.pipe(psocket);
  });
  preq.on("error", () => socket.destroy());
  preq.end();
  if (head?.length) {
    /* head already consumed by request path; ok */
  }
}

// --- Create server (HTTP or HTTPS) ---
const server = useHttps
  ? https.createServer(sslOptions, handleRequest)
  : http.createServer(handleRequest);

server.on("upgrade", handleUpgrade);

server.listen(PORT, "0.0.0.0", () => {
  const proto = useHttps ? "https" : "http";
  console.log(
    `meeting gateway on ${proto}://0.0.0.0:${PORT}  front=${FRONT_ROOT}  api=${API_UPSTREAM}  ws=${WS_UPSTREAM}` +
      (useHttps ? `  certs=${certDir}` : "  (no certs, HTTP only)"),
  );
});
