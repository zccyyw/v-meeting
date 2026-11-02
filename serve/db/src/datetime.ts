import type { Db } from "./types.js";

/**
 * 可安全写入 DATETIME / TIMESTAMP / TIMESTAMPTZ 列的值。
 * - string：无时区后缀的 'YYYY-MM-DD HH:mm:ss'（MySQL/PG 的 timestamp 字面量），
 *   或带 T/Z 的 ISO-8601（SQLite 的 TEXT 列口径）
 * - Date：交给驱动自行序列化（PG 的 node-postgres 会带时区偏移，适配 TIMESTAMPTZ）
 */
export type SqlDateTime = string | Date;

/**
 * 将入参时间归一化为可安全写入时间列的值；空值/非法值返回 null。
 *
 * 背景（2026-10 线上故障）：前端 `new Date(x).toISOString()` 产生
 * '2026-10-30T16:30:00.000Z'，MySQL 在 STRICT_TRANS_TABLES 下写入 DATETIME 会报
 * ER_TRUNCATED_WRONG_VALUE(1292)（'Z' 被当作待截断的多余字符而非时区偏移），
 * 该异常未被路由捕获 → 全局兜底 500。
 *
 * 各驱动口径（务必与 nowSql() 保持一致，否则同一张表里两种时间基准会错位）：
 * - mysql：'YYYY-MM-DD HH:mm:ss' 服务端本地墙上时间 —— 与 NOW() 同基准。
 *   因此容器 TZ 必须与数据库一致（见 compose 的 TZ=Asia/Shanghai）；
 *   若应用侧按 UTC 格式化而库里 NOW() 是 +8，会出现整体 8 小时偏移。
 * - postgres：直接返回 Date —— node-postgres 序列化时会带上时区偏移，
 *   TIMESTAMPTZ 才能还原到正确瞬时点（裸字符串会被按服务端 TimeZone 解释）。
 * - sqlite：列为 TEXT，沿用带 T/Z 的 ISO-8601 —— 与 datetime('now')（UTC）同基准，
 *   且可被 new Date() 无歧义解析（无时区字符串会被按本地时间解析而偏移）。
 *
 * 返回 null 时调用方应显式返回 400：NOT NULL 列收到 null 同样会 500。
 */
export function toSqlDateTime(
  db: Db,
  value: string | Date | null | undefined,
): SqlDateTime | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;

  if (db.driver === "sqlite") return d.toISOString();
  if (db.driver === "postgres") return d;

  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 把驱动返回值（Date / ISO 串 / 无时区串）解析为 Date。
 * 无时区串（SQLite 的 'YYYY-MM-DD HH:MM:SS'）按服务端本地时区解释 —— 与
 * formatLocalDateTime 的输出口径互为逆运算，保证往返不漂移。
 */
export function parseDateTime(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const s = String(value).trim();
  // 无时区标记：'YYYY-MM-DD HH:MM:SS' → 本地时间（SQLite 场景同此口径）
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * 展示/落库用的时间字符串：'YYYY-MM-DD HH:mm:ss'（不带 T/Z，服务端本地时区，
 * 部署上统一为 Asia/Shanghai）。与库内 NOW() 同基准，避免同一张表两套时间基准。
 * 空值/非法值返回 null（调用方按需要兜底为 ""）。
 *
 * 注意：不要再用 `new Date(v).toISOString().slice(0,19).replace("T"," ")` 产出
 * 后再用 `new Date(s.replace(" ","T"))` 反解 —— 那是「UTC 墙上时间 → 按本地解析」
 * 的往返，只在进程 TZ=UTC 时自洽，TZ=Asia/Shanghai 下会整体偏移 8 小时。
 */
export function formatLocalDateTime(value: unknown): string | null {
  const d = parseDateTime(value);
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 取毫秒时间戳（用于时长计算）：非法值返回 NaN。 */
export function epochMs(value: unknown): number {
  const d = parseDateTime(value);
  return d ? d.getTime() : NaN;
}
