// 构建期注入的版本号（由 vite.config.ts 的 define 提供，见 vite-env.d.ts 声明）。
// 站点设置中 site.version 为空时，前端以此作为页脚/页签版本的兜底值。
declare const __APP_VERSION__: string;

export const APP_VERSION: string =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
