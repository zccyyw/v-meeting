/**
 * PWA 关闭态（VITE_PWA_ENABLED != 1）的占位实现。
 *
 * 背景：`src/main.tsx` 里是**静态** `import { registerSW } from "virtual:pwa-register"`；
 * 关闭 PWA 时不会加载 vite-plugin-pwa，该虚拟模块也就不存在，静态 import 会让构建直接失败。
 * 因此 front/vite.config.ts 在关闭态用 resolve.alias 把 `virtual:pwa-register` 指到本文件，
 * 保证 main.tsx 无需改动即可正常构建、且不会注册任何 Service Worker。
 */
export type RegisterSWOptions = Record<string, unknown>;

export function registerSW(_options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}

export default registerSW;
