/**
 * 生产环境密码传输加密密钥（MEETING_CRYPTO_KEY）启动校验。
 *
 * 背景：serve/shared/src/crypto.ts 在未配置 MEETING_CRYPTO_KEY 时回退到源码内置
 * 默认密钥——该默认值随代码公开，生产环境继续使用等同于密码"应用层加密"形同虚设。
 * 因此 NODE_ENV=production 时 API 启动执行 fail-fast：
 *   - 未设置 / 空值 / 模板占位值（change-me-crypto-key）→ 抛错拒绝启动；
 *   - 长度 < 32 → 允许启动但告警（getKeyBytes 会循环填充到 32 字节，熵不足）。
 *
 * NODE_ENV=production 的注入来源：
 *   - Docker：serve/api/Dockerfile 已内置 ENV NODE_ENV=production；
 *   - 主机部署：systemd 单元（deploy/native[/systemd-rpm]/meeting-api.service）
 *     以 Environment=NODE_ENV=production 注入。
 * 开发环境（npm run dev）不设置 NODE_ENV，不受影响，保持内置默认密钥回退。
 */
const PLACEHOLDER_VALUES = new Set(["change-me-crypto-key"]);

export function assertProductionCryptoKey(
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env.NODE_ENV !== "production") return;
  const key = (env.MEETING_CRYPTO_KEY ?? "").trim();
  if (!key || PLACEHOLDER_VALUES.has(key.toLowerCase())) {
    throw new Error(
      "[crypto] MEETING_CRYPTO_KEY is required in production (generate: openssl rand -base64 32)"
    );
  }
  if (key.length < 32) {
    console.warn(
      "[crypto] MEETING_CRYPTO_KEY is shorter than 32 characters; AES key entropy is reduced"
    );
  }
}