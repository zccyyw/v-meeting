import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, "");
  const frontPort = Number(env.FRONT_PORT ?? 8081);
  const wsPort = Number(env.WS_PORT ?? 8082);
  const appName = env.VITE_APP_NAME ?? "Meeting";
  const appLogo = env.VITE_APP_LOGO ?? "/favicon.svg";

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
      // 代理 /ws 到 realtime 服务器，使 VITE_WS_URL 未设置或为 "auto" 时
      // 前端可通过 ws://<host>/ws 连接，无需直连 8082 端口
      proxy: {
        "/ws": {
          target: `http://127.0.0.1:${wsPort}`,
          ws: true,
        },
      },
    },
    preview: {
      port: frontPort,
      strictPort: true,
    },
  };
});
