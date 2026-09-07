import { resolveDriver, type Db, type DbDriver } from "./types.js";

export type {
  Db,
  DbDriver,
  QueryResult,
  ResultHeader,
} from "./types.js";
export {
  isUniqueViolation,
  resolveDriver,
  qmarksToDollar,
} from "./types.js";

/**
 * 返回当前时间戳 SQL 表达式，兼容 SQLite / MySQL / PostgreSQL。
 * - SQLite:   datetime('now')
 * - MySQL:     NOW()
 * - PostgreSQL: CURRENT_TIMESTAMP
 * api 与 realtime 共用同一实现，避免方言判断漂移。
 */
export function nowSql(db: Db): string {
  if (db.driver === "sqlite") return "datetime('now')";
  if (db.driver === "postgres") return "CURRENT_TIMESTAMP";
  return "NOW()";
}

export async function createPool(driver: DbDriver = resolveDriver()): Promise<Db> {
  if (driver === "postgres") {
    const { createPostgresPool } = await import("./postgres.js");
    return createPostgresPool();
  }
  if (driver === "sqlite") {
    const { createSqliteDb } = await import("./sqlite.js");
    return createSqliteDb();
  }
  const { createMysqlPool } = await import("./mysql.js");
  return createMysqlPool();
}
