import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "@/App.tsx";
import { ThemeProvider } from "@/theme/ThemeProvider";

// 【PWA 暂停用 2026-09-17】PWA 相关代码整体注释保留（未删除），恢复方法：
// 取消本文件下方两处注释，并同时恢复 front/vite.config.ts 内所有标注 [PWA-RESTORE]
// 的段落（VitePWA 插件、virtual:pwa-register alias、自毁 SW）。
// import { registerSW } from "virtual:pwa-register";

// 注册 PWA Service Worker。vite-plugin-pwa 配置为 registerType: "prompt"，
// 不会自动注册，必须在此显式注册，否则 manifest 声明的 PWA 离线缓存与
// 安装能力完全失效（部分浏览器还会在控制台输出相关告警）。
// registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>
);
