import { describe, it, expect, afterAll } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  utimesSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "@meeting/db";

// 录制磁盘治理（P1-4）回归：保留期清理 + 孤儿扫描。
// 环境变量必须在动态 import recordings.ts 之前设置（模块顶层读取）。
const dir = mkdtempSync(join(tmpdir(), "meeting-rec-test-"));
const recDir = join(dir, "recordings");
process.env.SQLITE_PATH = join(dir, "test.sqlite");
process.env.RECORDINGS_DIR = recDir;
process.env.RECORDINGS_RETENTION_DAYS = "30";
process.env.RECORDINGS_MIN_FREE_MB = "0";
mkdirSync(recDir, { recursive: true });
const db = await createPool("sqlite");
const { cleanupRecordings } = await import("../src/routes/recordings.js");

afterAll(() => {
  void db.end();
  rmSync(dir, { recursive: true, force: true });
});

async function setupTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS recordings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER,
    owner_user_id INTEGER,
    title TEXT,
    duration_ms INTEGER,
    size_bytes INTEGER,
    storage_path TEXT,
    source TEXT,
    created_at TEXT
  )`);
}

describe("cleanupRecordings", () => {
  it("deletes expired rows+files, keeps recent rows, removes old orphans", async () => {
    await setupTable();
    const oldIso = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const oldFile = join(recDir, "old.webm");
    const recentFile = join(recDir, "recent.webm");
    const orphanOld = join(recDir, "orphan-old.webm");
    const orphanFresh = join(recDir, "orphan-fresh.webm");
    const orphanPart = join(recDir, "upload.part");
    for (const f of [oldFile, recentFile, orphanOld, orphanFresh, orphanPart]) {
      writeFileSync(f, "x");
    }
    // 孤儿：mtime 设为 2 天前（fresh 保持当前时间）
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(orphanOld, twoDaysAgo, twoDaysAgo);
    utimesSync(orphanPart, twoDaysAgo, twoDaysAgo);

    await db.query(
      `INSERT INTO recordings (owner_user_id, title, storage_path, created_at) VALUES (1, 'old', ?, ?)`,
      [oldFile, oldIso],
    );
    await db.query(
      `INSERT INTO recordings (owner_user_id, title, storage_path, created_at) VALUES (1, 'recent', ?, ?)`,
      [recentFile, new Date().toISOString()],
    );

    await cleanupRecordings(db);

    // 保留期：过期行+文件删除
    expect(existsSync(oldFile)).toBe(false);
    const [left] = await db.query(`SELECT title FROM recordings`);
    const titles = (left as { title: string }[]).map((r) => r.title);
    expect(titles).toEqual(["recent"]);
    expect(existsSync(recentFile)).toBe(true);
    // 孤儿扫描：老孤儿（含 .part）删除，新文件保留
    expect(existsSync(orphanOld)).toBe(false);
    expect(existsSync(orphanPart)).toBe(false);
    expect(existsSync(orphanFresh)).toBe(true);
  });

  it("never deletes rows with unparseable created_at", async () => {
    await setupTable();
    const f = join(recDir, "bad-date.webm");
    writeFileSync(f, "x");
    await db.query(
      `INSERT INTO recordings (owner_user_id, title, storage_path, created_at) VALUES (1, 'bad', ?, 'not-a-date')`,
      [f],
    );
    await cleanupRecordings(db);
    const [rows] = await db.query(`SELECT title FROM recordings WHERE title = 'bad'`);
    expect((rows as unknown[]).length).toBe(1);
    expect(existsSync(f)).toBe(true);
  });
});