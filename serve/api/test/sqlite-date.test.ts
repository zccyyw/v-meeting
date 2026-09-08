import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "@meeting/db";

// 回归测试：better-sqlite3 不接受 Date 绑定（mysql2/pg 均接受），
// 历史上 5 处路由直接传 Date 导致 SQLite 部署下建会全挂（500）。
// 驱动层现统一归一化为 ISO-8601，auth-bridge 的 new Date(...) 可精确解析。
const dir = mkdtempSync(join(tmpdir(), "meeting-db-test-"));
process.env.SQLITE_PATH = join(dir, "test.sqlite");
const db = await createPool("sqlite");

afterAll(() => {
  void db.end();
  rmSync(dir, { recursive: true, force: true });
});

describe("sqlite driver parameter normalization", () => {
  it("binds Date parameters as ISO-8601 strings", async () => {
    await db.query(
      `CREATE TABLE IF NOT EXISTS t_date_norm (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL)`,
    );
    const d = new Date("2026-09-08T12:34:56.789Z");
    // 修复前：此处抛 "SQLite3 can only bind numbers, strings, bigints, buffers, and null"
    await db.query(`INSERT INTO t_date_norm (at) VALUES (?)`, [d]);
    const [rows] = await db.query(`SELECT at FROM t_date_norm ORDER BY id DESC LIMIT 1`);
    const stored = (rows as { at: string }[])[0].at;
    // 存储格式必须带时区标记，保证 new Date() 精确解析（不按本地时区偏移）
    expect(stored).toBe(d.toISOString());
    expect(new Date(stored).getTime()).toBe(d.getTime());
    // 无时区格式（SQLite datetime('now') 风格）会被按本地时间解析，必须避免
    expect(stored).toMatch(/T.*Z$/);
  });

  it("passes through non-Date params untouched", async () => {
    await db.query(`CREATE TABLE IF NOT EXISTS t_plain (id INTEGER PRIMARY KEY, v TEXT)`);
    await db.query(`INSERT INTO t_plain (id, v) VALUES (?, ?)`, [1, "hello"]);
    const [rows] = await db.query(`SELECT v FROM t_plain WHERE id = ?`, [1]);
    expect((rows as { v: string }[])[0].v).toBe("hello");
    await db.query(`INSERT OR REPLACE INTO t_plain (id, v) VALUES (?, ?)`, [1, null]);
    const [rows2] = await db.query(`SELECT v FROM t_plain WHERE id = ?`, [1]);
    expect((rows2 as { v: unknown }[])[0].v).toBeNull();
  });
});
