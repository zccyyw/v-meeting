/**
 * 运行时配置读取：优先部署端注入的 window.__APP_CONFIG__（由 /app-config.js 提供：
 * docker 为 web 容器启动时生成；主机部署由网关动态输出），缺省回退构建期值。
 * 目的：让应用名 / API 与 WS 地址等前端参数支持「安装前改 .env、安装/启动后生效」，
 * 无需重新构建前端。
 */
export interface AppConfig {
  appName?: string;
  apiBase?: string;
  wsUrl?: string;
  cryptoKey?: string;
}

export function getAppConfig(): AppConfig {
  return (globalThis as { __APP_CONFIG__?: AppConfig }).__APP_CONFIG__ ?? {};
}
