import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 开发用 HTTPS：存在证书文件时自动启用（局域网多人测试必需）。
 * 证书目录可由 DEV_CERT_DIR 指定，默认 <repo>/.certs。
 */
function resolveDevHttps(certDir: string) {
  const cert = path.resolve(repoRoot, certDir, "fullchain.pem");
  const key = path.resolve(repoRoot, certDir, "privkey.pem");
  if (!fs.existsSync(cert) || !fs.existsSync(key)) return {};
  return {
    https: {
      cert: fs.readFileSync(cert),
      key: fs.readFileSync(key),
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const frontPort = Number(env.FRONT_PORT ?? 8081);
  const apiPort = Number(env.API_PORT ?? 8080);
  const wsPort = Number(env.WS_PORT ?? 8082);
  const appName = env.VITE_APP_NAME ?? "Meeting";
  const appLogo = env.VITE_APP_LOGO ?? "/favicon.svg";
  const devHttps = resolveDevHttps(env.DEV_CERT_DIR || ".certs");

  return {
    envDir: repoRoot,
    build: {
      // 信创浏览器（奇安信涉密版等）内核较老（可能 ≤ Chrome 102），
      // 显式降到 es2020 避免默认 target（≈Chrome 107+）产出的语法不被支持。
      // 已扫描确认业务代码无 es2021+ 运行时 API 依赖，转译即可覆盖。
      target: "es2020",
    },
    define: {
      // 注入 AES-GCM 加密密钥到前端（与后端 MEETING_CRYPTO_KEY 保持一致）
      __MEETING_CRYPTO_KEY__: JSON.stringify(env.MEETING_CRYPTO_KEY ?? ""),
    },
    resolve: {
      alias: {
        "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src"),
      },
    },
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        includeAssets: ["icons/*.png", "favicon.svg"],
        manifest: {
          name: appName,
          short_name: appName,
          start_url: "/",
          display: "standalone",
          background_color: "#0b1220",
          theme_color: "#0b1220",
          icons: [
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            { src: appLogo, sizes: "any", type: "image/svg+xml", purpose: "any" },
          ],
        },
        workbox: {
          navigateFallback: "/index.html",
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          runtimeCaching: [],
        },
      }),
    ],
    server: {
      port: frontPort,
      strictPort: true,
      // 监听 0.0.0.0：允许局域网其他机器访问（多人联调）
      host: true,
      // 局域网多人测试需要 HTTPS —— 浏览器仅在安全上下文
      // （https 或 localhost）下提供 crypto.subtle 与 getUserMedia。
      // 存在证书文件时自动启用；证书生成：
      //   npm run cert:dev -- <本机局域网IP>
      ...devHttps,
      // 代理 /ws 到 realtime 服务器，使 VITE_WS_URL 未设置或为 "auto" 时
      // 前端可通过 ws(s)://<host>/ws 连接，无需直连 8082 端口
      proxy: {
        "/ws": {
          target: `http://127.0.0.1:${wsPort}`,
          ws: true,
        },
        // 同源代理 /api：局域网 HTTPS 访问时若直连 http://127.0.0.1:8080
        // 会被浏览器按混合内容拦截（且 127.0.0.1 指向的是客户端自己）。
        "/api": {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port: frontPort,
      strictPort: true,
    },
  };
});
