import type { Db } from "./db.js";

// nowSql 统一实现位于 @meeting/db（api 与 realtime 共用），此处保留导出位置
export { nowSql } from "./db.js";

/**
 * 返回 INSERT IGNORE 语法前缀，兼容 SQLite/MySQL/PostgreSQL
 * - SQLite:     INSERT OR IGNORE INTO
 * - MySQL:      INSERT IGNORE INTO
 * - PostgreSQL: INSERT INTO ... ON CONFLICT DO NOTHING（需配合唯一约束）
 */
export function insertIgnorePrefix(db: Db): string {
  if (db.driver === "sqlite") return "INSERT OR IGNORE INTO";
  if (db.driver === "postgres") return "INSERT INTO";
  return "INSERT IGNORE INTO";
}

/**
 * 对于 PostgreSQL 的关联表 INSERT，追加 ON CONFLICT DO NOTHING
 */
export function conflictSuffix(db: Db, conflictTarget: string): string {
  if (db.driver === "postgres") return ` ON CONFLICT (${conflictTarget}) DO NOTHING`;
  return "";
}

/**
 * 判断表是否存在，兼容 SQLite/MySQL/PostgreSQL
 */
export async function tableExists(db: Db, tableName: string): Promise<boolean> {
  if (db.driver === "sqlite") {
    const [rows] = await db.query(
      `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=? LIMIT 1`,
      [tableName],
    );
    return (rows as unknown[]).length > 0;
  }
  if (db.driver === "postgres") {
    const [rows] = await db.query(
      `SELECT 1 AS ok FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1`,
      [tableName],
    );
    return (rows as unknown[]).length > 0;
  }
  const [rows] = await db.query(
    `SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = database() AND table_name = ? LIMIT 1`,
    [tableName],
  );
  return (rows as unknown[]).length > 0;
}

/**
 * 判断 sys_user 表是否存在（迁移完成标志）
 */
export async function hasSysUser(db: Db): Promise<boolean> {
  return tableExists(db, "sys_user");
}
