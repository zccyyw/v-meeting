import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// [PWA-RESTORE] PWA 暂停用（2026-09-17）：恢复时取消本行及文件内其余 [PWA-RESTORE] 段落的注释，
// 并同步恢复 front/src/main.tsx 中的 registerSW（共三处，均有同一标注，防遗漏）。
// import { VitePWA } from "vite-plugin-pwa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * 品牌与 PWA 的仓库默认值：按客户定制时在**构建前**修改 config/branding.json 即可
 * （也可用环境变量 VITE_APP_NAME / VITE_APP_LOGO / VITE_PWA_ENABLED 临时覆盖）。
 * 这些是构建期参数，烤进产物后运行期无法更改。
 */
function loadBranding() {
  const fallback = { appName: "Meeting", appLogo: "/favicon.svg", pwaEnabled: false };
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, "config", "branding.json"), "utf8"));
    return {
      appName: typeof raw.appName === "string" && raw.appName ? raw.appName : fallback.appName,
      appLogo: typeof raw.appLogo === "string" && raw.appLogo ? raw.appLogo : fallback.appLogo,
      pwaEnabled: raw.pwaEnabled === true,
    };
  } catch {
    return fallback;
  }
}

// 【PWA 暂停用 2026-09-17】以下「自毁 Service Worker」逻辑整段注释保留（未删除）。
// 恢复方法：见文件底部 plugins 数组处的 [PWA-RESTORE] 说明。
// /**
//  * PWA 关闭时产出的「自毁 Service Worker」。
//  * 用途：旧版本开过 PWA 的客户端仍注册着 SW，切到关闭态后需要主动注销并清缓存，
//  * 否则旧缓存长期驻留可能在升级后表现为白屏 / 资源 404。
//  */
// const SELF_DESTROYING_SW = `/* 由前端构建生成：PWA 已关闭，本 SW 仅用于注销历史注册并清理缓存 */
// self.addEventListener("install", () => self.skipWaiting());
// self.addEventListener("activate", (event) => {
//   event.waitUntil((async () => {
//     try {
//       const keys = await caches.keys();
//       await Promise.all(keys.map((k) => caches.delete(k)));
//       await self.registration.unregister();
//       const clients = await self.clients.matchAll({ type: "window" });
//       for (const client of clients) client.navigate(client.url);
//     } catch {
//       /* 尽力清理，失败忽略 */
//     }
//   })());
// });
// `;
//
// function selfDestroyingSwPlugin(): Plugin {
//   return {
//     name: "meeting-self-destroying-sw",
//     apply: "build",
//     generateBundle() {
//       this.emitFile({ type: "asset", fileName: "sw.js", source: SELF_DESTROYING_SW });
//     },
//   };
// }

/**
 * 构建期把品牌值注入 index.html。
 * 不用 Vite 的 %VITE_*% 占位符替换：那依赖"构建环境里恰好有该变量"，
 * 而 CI 构建上下文不含 .env（.dockerignore 排除），会留下未替换的占位符出厂。
 */
function brandingPlugin(fe: { appName: string; appLogo: string }): Plugin {
  return {
    name: "meeting-branding",
    transformIndexHtml(html) {
      return html
        .replace(/<title>[\s\S]*?<\/title>/, `<title>${fe.appName}</title>`)
        .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, `$1${fe.appName}$2`)
        .replace(/(<link rel="icon"[^>]*href=")[^"]*(")/, `$1${fe.appLogo}$2`);
    },
  };
}

/**
 * 开发用 HTTPS：存在证书文件时自动启用（局域网多人测试必需）。
 * 证书目录可由 DEV_CERT_DIR 指定，默认 <repo>/.certs。
 * 设 DEV_HTTPS=0 可显式关闭（即使证书存在也不启用），本地 localhost 调试用。
 */
function resolveDevHttps(certDir: string, forceOff: boolean) {
  if (forceOff) return {};
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
  const branding = loadBranding();
  // 品牌与 PWA：环境变量（临时覆盖） → config/branding.json（客户定制入口）
  const fe = {
    // 空字符串按"未设置"处理，避免 CI 传空值导致标题/图标为空
    appName: env.VITE_APP_NAME || branding.appName,
    appLogo: env.VITE_APP_LOGO || branding.appLogo,
    pwa: env.VITE_PWA_ENABLED !== undefined ? env.VITE_PWA_ENABLED === "1" : branding.pwaEnabled,
  };
  const devHttps = resolveDevHttps(env.DEV_CERT_DIR || ".certs", env.DEV_HTTPS === "0");

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
        "@": path.resolve(frontRoot, "src"),
        // [PWA-RESTORE] PWA 暂停用：main.tsx 的静态 import 已注释，此 alias 一并注释。
        // 恢复 PWA 时取消下面的注释（配合 plugins 数组处的 VitePWA 与自毁 SW）。
        // ...(fe.pwa
        //   ? {}
        //   : { "virtual:pwa-register": path.resolve(frontRoot, "src/pwa/register-noop.ts") }),
      },
    },
    plugins: [
      react(),
      brandingPlugin(fe),
      // [PWA-RESTORE] PWA 暂停用（2026-09-17）：整段注释保留。恢复步骤：
      //   1) 取消本段（VitePWA 插件与自毁 SW 分支）注释；
      //   2) 取消文件顶部 `import { VitePWA }` 与 resolve.alias 处 virtual:pwa-register 的注释；
      //   3) 恢复 front/src/main.tsx 中的 registerSW（同标注）。
      // 恢复后如需"安装期开关"，方案已定：构建始终产出 PWA 资源，运行时由 /app-config.js 决定注册与否。
      // ...(fe.pwa
      //   ? [
      //       VitePWA({
      //         registerType: "prompt",
      //         includeAssets: ["icons/*.png", "favicon.svg"],
      //         manifest: {
      //           name: fe.appName,
      //           short_name: fe.appName,
      //           start_url: "/",
      //           display: "standalone",
      //           background_color: "#0b1220",
      //           theme_color: "#0b1220",
      //           icons: [
      //             { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      //             { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      //             { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      //             { src: fe.appLogo, sizes: "any", type: "image/svg+xml", purpose: "any" },
      //           ],
      //         },
      //         workbox: {
      //           navigateFallback: "/index.html",
      //           globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      //           runtimeCaching: [],
      //         },
      //       }),
      //     ]
      //   : [selfDestroyingSwPlugin()]),
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
