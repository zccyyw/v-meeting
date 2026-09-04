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
      const isInsert = /^\s*INSERT\s+/i.test(sql);
      const isModify = /^\s*(UPDATE|DELETE)\s+/i.test(sql);

      if (isInsert) {
        const info = stmt.run(...params);
        const header: ResultHeader = {
          insertId: Number(info.lastInsertRowid),
          affectedRows: info.changes,
        };
        return Promise.resolve([header, info] as [QueryResult, unknown]);
      }
      if (isModify) {
        const info = stmt.run(...params);
        const header: ResultHeader = { insertId: 0, affectedRows: info.changes };
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
