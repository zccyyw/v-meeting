import Database from "better-sqlite3";
import type { Db, QueryResult, ResultHeader } from "./types.js";

export function createSqliteDb(): Db {
  const dbPath = process.env.SQLITE_PATH ?? "/app/data/meeting.sqlite";
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  return {
    driver: "sqlite",
    query(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      // better-sqlite3 只接受 number/string/bigint/buffer/null 绑定参数，
      // 不支持 Date 对象（mysql2/pg 均支持）。统一在此归一化为 ISO-8601
      // （带 T/Z），保证 auth-bridge 的 new Date(row.expires_at) 精确解析，
      // 避免无时区字符串被按本地时间解析导致的偏移。
      const norm = params.map((p) => (p instanceof Date ? p.toISOString() : p));
      // better-sqlite3 要求：返回结果行的语句用 all()，其余（INSERT/UPDATE/
      // DELETE/CREATE/ALTER/DROP/PRAGMA 等）必须用 run()，否则抛
      // "This statement does not return data. Use run() instead"。
      // 用 stmt.reader 判断（官方提供的元数据），比正则匹配 SQL 前缀更可靠：
      // 旧实现只识别 INSERT/UPDATE/DELETE，导致 DDL（迁移建表）直接崩溃。
      if (!stmt.reader) {
        const info = stmt.run(...norm);
        const header: ResultHeader = {
          insertId: Number(info.lastInsertRowid ?? 0),
          affectedRows: info.changes,
        };
        return Promise.resolve([header, info] as [QueryResult, unknown]);
      }
      const isInsert = /^\s*INSERT\s+/i.test(sql);
      if (isInsert) {
        const info = stmt.run(...params);
        const header: ResultHeader = {
          insertId: Number(info.lastInsertRowid),
          affectedRows: info.changes,
        };
        return Promise.resolve([header, info] as [QueryResult, unknown]);
      }
      const rows = stmt.all(...params) as Record<string, unknown>[];
      return Promise.resolve([rows, rows] as [QueryResult, unknown]);
    },
    end() {
      db.close();
      return Promise.resolve();
    },
  };
}
