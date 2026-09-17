#!/usr/bin/env node
/**
 * Lightweight edge: static front + /api proxy + /ws upgrade proxy.
 * Supports both HTTP and HTTPS (auto-detects certs).
 *
 * Env: FRONT_ROOT, API_UPSTREAM, WS_UPSTREAM, GATEWAY_PORT (default 443),
 *      CERT_DIR (default: ../certs — 提供 fullchain.pem + privkey.pem 时启用 HTTPS)
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
const PORT = Number(process.env.GATEWAY_PORT || 443);

// --- HTTPS support: auto-detect certs in CERT_DIR or ../certs ---
const certDir = process.env.CERT_DIR
  ? path.resolve(process.env.CERT_DIR)
  : path.resolve(__dirname, "../certs");
const certFile = path.join(certDir, "fullchain.pem");
const keyFile = path.join(certDir, "privkey.pem");
let sslOptions = null;
if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  try {
    sslOptions = { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) };
  } catch (err) {
    // 证书文件存在却读不到：绝大多数是私钥归属/权限问题 ——
    // gateway 以非特权用户运行（systemd `User=meeting`），而证书通常由 root 用 sudo 生成（0600）。
    console.error(`[gateway] 读取证书失败（${err.code || "ERROR"}）：${err.path || certDir}`);
    console.error(`[gateway] 修复：sudo chown meeting:meeting ${keyFile} && sudo chmod 600 ${keyFile}`);
    console.error("[gateway] 重新生成（脚本会自动调整归属）：");
    console.error("[gateway]   sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs --ca <服务器IP>");
    process.exit(1);
  }
}
const useHttps = Boolean(sslOptions);

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

/**
 * 必须真实存在、缺失就该 404 的静态资源后缀。
 * 原因：SPA fallback 会把缺失路径返回 index.html，浏览器若把它当脚本/图标解析，
 * 会出现「/sw.js 拿到 HTML → 旧 Service Worker 无法注销」这类难查问题。
 */
const STATIC_EXT = new Set([
  ".js", ".mjs", ".css", ".json", ".map", ".txt",
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico",
  ".woff", ".woff2", ".ttf", ".wasm", ".webmanifest",
]);

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  const data = fs.readFileSync(filePath);
  const headers = { "Content-Type": type, "Content-Length": data.length };
  const base = path.basename(filePath);
  if (base === "sw.js" || base === "manifest.webmanifest") {
    // Service Worker / manifest 必须每次校验：no-store 保证浏览器拿到最新状态
    // （PWA 关闭时 sw.js 为自毁脚本，缓存住就注销不掉）
    headers["Cache-Control"] = "no-store";
  } else if (ext === ".html") {
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

/**
 * 运行时配置：动态输出 /app-config.js（读本进程 env —— systemd 单元已
 * EnvironmentFile=conf/.env，改 .env 后重启服务即同步）。
 * 前端「运行时优先、构建值兜底」：应用名 / 密码加密密钥 / API 与 WS 地址因此支持
 * 「安装后、首次启动前改 .env（或之后改 + 重启）即生效」，无需重新构建前端。
 * 注意 no-store：配置可能随时被修改，浏览器不得缓存。
 */
function renderAppConfig() {
  const js = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const out = [
    "/* 由网关动态生成（来源：conf/.env），请勿手工编辑 */",
    "(function () {",
    "  var c = window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};",
  ];
  if (process.env.VITE_APP_NAME) {
    out.push(`  c.appName = "${js(process.env.VITE_APP_NAME)}";`);
    out.push("  document.title = c.appName;");
    out.push(`  var m = document.querySelector('meta[name="apple-mobile-web-app-title"]');`);
    out.push(`  if (m) m.setAttribute("content", c.appName);`);
  }
  if (process.env.MEETING_CRYPTO_KEY) {
    out.push(`  c.cryptoKey = "${js(process.env.MEETING_CRYPTO_KEY)}";`);
    out.push("  window.__MEETING_CRYPTO_KEY__ = c.cryptoKey;");
  }
  if (process.env.VITE_API_BASE) {
    out.push(`  c.apiBase = "${js(process.env.VITE_API_BASE)}";`);
  }
  if (process.env.VITE_WS_URL) {
    out.push(`  c.wsUrl = "${js(process.env.VITE_WS_URL)}";`);
  }
  out.push("})();", "");
  return out.join("\n");
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", "http://gateway.local");
  // logo 定制：FRONT_ROOT/branding/ 下的 favicon.svg|ico 优先（该目录不属 rpm/deb 包，
  // 升级不会被覆盖；直接覆盖 app/front/favicon.svg 也可以，但升级包会还原，见部署文档）
  if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
    const brandingFile = path.join(FRONT_ROOT, "branding", path.basename(url.pathname));
    if (fs.existsSync(brandingFile)) {
      sendFile(res, brandingFile);
      return;
    }
  }
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
    // 静态资源后缀缺失 → 必须 404，不能回退 index.html
    // （否则 /sw.js、/favicon.svg 之类会返回 HTML，误导浏览器与服务缓存）
    if (STATIC_EXT.has(path.extname(url.pathname).toLowerCase())) {
      res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end("Not found");
      return;
    }
    // SPA fallback（前端路由）
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
  // 运行时配置（前端「安装前改 .env、启动后生效」的注入点），优先于静态文件
  if (url === "/app-config.js" || url.startsWith("/app-config.js?")) {
    res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
    res.end(renderAppConfig());
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
