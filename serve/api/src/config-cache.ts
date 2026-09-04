import type { Db } from "./db.js";

/**
 * 配置缓存层 — 避免每次请求都查库读取 sys_config。
 *
 * 用法:
 *   import { getConfig, getConfigInt, getConfigBool } from "./config-cache.js";
 *   const maxUsers = await getConfigInt(db, "sys.online.maxUsers", 20);
 *
 * 缓存 TTL 为 60 秒，可通过 invalidateConfig() 手动失效。
 */
const configCache = new Map<string, { value: string; expires: number }>();
const CACHE_TTL = 60_000; // 1 分钟

/**
 * 读取 sys_config 中的字符串配置值（带缓存）。
 * 如果配置项不存在或表不存在，返回 defaultValue。
 */
export async function getConfig(
  db: Db,
  key: string,
  defaultValue: string = "",
): Promise<string> {
  const cached = configCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const [rows] = await db.query(
      `SELECT config_value FROM sys_config WHERE config_key = ? LIMIT 1`,
      [key],
    );
    const value =
      (rows as { config_value?: string }[])[0]?.config_value ?? defaultValue;
    configCache.set(key, { value, expires: Date.now() + CACHE_TTL });
    return value;
  } catch {
    // 表不存在或查询失败，返回默认值
    return defaultValue;
  }
}

/**
 * 读取 sys_config 中的整型配置值（带缓存）。
 */
export async function getConfigInt(
  db: Db,
  key: string,
  defaultValue: number,
): Promise<number> {
  const raw = await getConfig(db, key, String(defaultValue));
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultValue;
}

/**
 * 读取 sys_config 中的布尔配置值（带缓存）。
 * "true" / "1" / "yes" 视为 true，其余为 false。
 */
export async function getConfigBool(
  db: Db,
  key: string,
  defaultValue: boolean,
): Promise<boolean> {
  const raw = await getConfig(db, key, String(defaultValue));
  const lower = raw.trim().toLowerCase();
  if (lower === "true" || lower === "1" || lower === "yes") return true;
  if (lower === "false" || lower === "0" || lower === "no") return false;
  return defaultValue;
}

/**
 * 手动失效单个配置缓存项。
 * 在更新 sys_config 后调用，确保下次读取拿到新值。
 */
export function invalidateConfig(key: string): void {
  configCache.delete(key);
}

/**
 * 清空所有配置缓存。
 */
export function clearConfigCache(): void {
  configCache.clear();
}
