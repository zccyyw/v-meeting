import type { FastifyInstance } from "fastify";
import { type Db, type ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";

const RECORDINGS_DIR =
  process.env.RECORDINGS_DIR ?? path.join(process.cwd(), "data", "recordings");

/** 磁盘水位：上传前可用空间低于该阈值（MB）时拒绝上传（0 = 关闭水位检查） */
const RECORDINGS_MIN_FREE_MB = (() => {
  const n = Number(process.env.RECORDINGS_MIN_FREE_MB);
  return Number.isFinite(n) && n > 0 ? n : 2048;
})();

/** 录制保留天数：启动/每日清理超期录制（0 = 永久保留，默认关闭，避免升级后静默删数据） */
const RECORDINGS_RETENTION_DAYS = (() => {
  const n = Number(process.env.RECORDINGS_RETENTION_DAYS);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
})();

/** 允许落盘的录制文件扩展名（其余一律按 .webm 处理），避免任意文件落盘 */
const ALLOWED_EXT = new Set([".webm", ".mkv", ".mp4", ".ogg", ".mov"]);

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeTitle(title: string): string {
  const t = title.trim().slice(0, 100);
  return t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "recording";
}

/**
 * 解析 recordings.created_at（三种方言写入格式：
 * SQLite datetime(''now'')="YYYY-MM-DD HH:MM:SS"(UTC) / MySQL NOW()(服务器本地) / PG Date 对象）。
 * 保留期按天粒度，时区偏移数小时可忽略；解析失败返回 null（视为不过期，宁可不删）。
 */
export function parseRecordingCreatedAt(v: unknown): number | null {
  if (v instanceof Date) return v.getTime();
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/.exec(s);
  if (m) {
    const t = Date.parse(`${m[1]}T${m[2]}Z`);
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/**
 * 录制磁盘治理（架构评审 P1-4）：
 * a) 保留期清理：先删 DB 行、后 unlink 文件（unlink 失败由孤儿扫描兜底）；
 * b) 孤儿扫描：目录中存在但 DB 无对应行、且 mtime 超过 24h 的文件（含 .part 残留）直接删除。
 * 查询全量行在 JS 侧过滤（目标部署规模为千级，避免三方言日期比较的精度/时区差异）。
 */
export async function cleanupRecordings(db: Db): Promise<void> {
  if (RECORDINGS_RETENTION_DAYS > 0) {
    const cutoffMs = Date.now() - RECORDINGS_RETENTION_DAYS * 86_400_000;
    const [rows] = await db.query(
      `SELECT id, created_at, storage_path FROM recordings`
    );
    for (const row of rows as { id: number | string; created_at: unknown; storage_path: string }[]) {
      const createdAt = parseRecordingCreatedAt(row.created_at);
      if (createdAt == null || createdAt > cutoffMs) continue;
      await db.query(`DELETE FROM recordings WHERE id = ?`, [row.id]);
      if (row.storage_path) {
        await fs.promises.unlink(row.storage_path).catch(() => {});
      }
    }
  }
  const [rows2] = await db.query(`SELECT storage_path FROM recordings`);
  const known = new Set(
    (rows2 as { storage_path: string }[])
      .map((r) => path.resolve(String(r.storage_path ?? "")))
      .filter((p) => p.length > 0)
  );
  let names: string[] = [];
  try {
    names = fs.readdirSync(RECORDINGS_DIR);
  } catch {
    return;
  }
  for (const name of names) {
    const full = path.join(RECORDINGS_DIR, name);
    if (known.has(path.resolve(full))) continue;
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      if (Date.now() - st.mtimeMs < 24 * 3_600_000) continue;
      await fs.promises.unlink(full).catch(() => {});
    } catch {
      /* ignore */
    }
  }
}

export async function recordingRoutes(
  app: FastifyInstance,
  db: Db,
  redis: Redis
) {
  ensureDir(RECORDINGS_DIR);

  // 磁盘治理：启动时清理一次，此后每 24h 一次（保留期 + 孤儿扫描；失败不影响服务）
  const runCleanup = () =>
    cleanupRecordings(db).catch((err) => console.error("recordings cleanup failed", err));
  void runCleanup();
  const cleanupTimer = setInterval(runCleanup, 24 * 3_600_000);
  cleanupTimer.unref();

  // 上传录制文件（multipart：file + meta 字段）
  app.post("/recordings/upload", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    // 磁盘水位检查：可用空间低于阈值时拒绝上传（近似保护：流式上传前无法预知大小，
    // 阈值保证最坏再写 1GB 仍有余量；statfs 不可用时跳过检查，不影响可用性）
    if (RECORDINGS_MIN_FREE_MB > 0) {
      try {
        const st = await fs.promises.statfs(RECORDINGS_DIR);
        const freeBytes = Number(st.bavail) * Number(st.bsize);
        if (freeBytes < RECORDINGS_MIN_FREE_MB * 1024 * 1024) {
          return reply.code(507).send({ error: "disk_full" });
        }
      } catch {
        /* statfs 不可用（旧内核/文件系统）：跳过水位检查 */
      }
    }

    // 注意：不要先 req.file() 再 req.parts()，会把文件流消费掉导致永远落到 upload_failed
    const fields: Record<string, string> = {};
    let tmpPath: string | null = null;
    let finalFilename = "";
    let sizeBytes = 0;
    let uploadFilename = "recording.webm";

    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname === "file") {
            uploadFilename = part.filename || uploadFilename;
            const extRaw = path.extname(uploadFilename).toLowerCase();
            const ext = ALLOWED_EXT.has(extRaw) ? extRaw : ".webm";
            const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
            finalFilename = `${id}-${Date.now()}${ext}`;
            // 流式落盘到 .part 临时文件，成功后再改名，失败不残留半成品
            tmpPath = path.join(RECORDINGS_DIR, `${finalFilename}.part`);
            const out = fs.createWriteStream(tmpPath, { flags: "wx" });
            await pipeline(part.file, out);
            sizeBytes = fs.statSync(tmpPath).size;
          } else {
            // 丢弃非预期文件字段，避免流卡住
            for await (const _chunk of part.file) {
              /* drain */
            }
          }
        } else {
          fields[String(part.fieldname)] = String(part.value);
        }
      }
    } catch (err) {
      // busboy 超过 fileSize 上限会以 LIMIT_FILE_SIZE 中断
      const limitHit = (err as { code?: string })?.code === "LIMIT_FILE_SIZE";
      if (tmpPath) {
        await fs.promises.unlink(tmpPath).catch(() => {});
      }
      console.error("parse multipart failed", err);
      return reply.code(limitHit ? 413 : 400).send({
        error: limitHit ? "file_too_large" : "invalid_multipart",
      });
    }

    if (!tmpPath || sizeBytes === 0) {
      if (tmpPath) await fs.promises.unlink(tmpPath).catch(() => {});
      return reply.code(400).send({ error: "no_file" });
    }

    try {
      const title = safeTitle(fields.title || "未命名录制");
      const meetingId = fields.meetingId ? Number(fields.meetingId) : null;
      const durationMs = Number(fields.durationMs) || 0;
      const storagePath = path.join(RECORDINGS_DIR, finalFilename);
      await fs.promises.rename(tmpPath, storagePath);

      const [result] = await db.query(
        `INSERT INTO recordings
         (meeting_id, owner_user_id, title, duration_ms, size_bytes, storage_path, source)
         VALUES (?, ?, ?, ?, ?, ?, 'client')`,
        [
          meetingId && Number.isFinite(meetingId) ? meetingId : null,
          user.id,
          title,
          durationMs,
          sizeBytes,
          finalFilename,
        ]
      );
      const recordingId = Number((result as ResultHeader).insertId);
      return reply.code(201).send({
        id: recordingId,
        title,
        durationMs,
        sizeBytes,
        url: `/api/recordings/${recordingId}/download`,
      });
    } catch (err) {
      // 清理可能残留的临时文件
      await fs.promises.unlink(tmpPath).catch(() => {});
      console.error("upload recording failed", err);
      return reply.code(500).send({ error: "upload_failed" });
    }
  });

  // 列表（当前用户的录制，支持分页）
  app.get("/recordings", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const q = req.query as { page?: string; pageSize?: string };
    const allowedSizes = new Set([10, 20, 30, 50]);
    let pageSize = Number(q.pageSize) || 10;
    if (!allowedSizes.has(pageSize)) pageSize = 10;
    let page = Math.floor(Number(q.page) || 1);
    if (!Number.isFinite(page) || page < 1) page = 1;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM recordings WHERE owner_user_id = ?`,
      [user.id]
    );
    const total = Number((countRows as any[])[0]?.cnt ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) page = totalPages;
    const safeOffset = (page - 1) * pageSize;

    const [rows] = await db.query(
      `SELECT r.id, r.meeting_id, r.title, r.duration_ms, r.size_bytes,
              r.storage_path, r.created_at, m.title AS meeting_title, m.code AS meeting_code
       FROM recordings r
       LEFT JOIN meetings m ON m.id = r.meeting_id
       WHERE r.owner_user_id = ?
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [user.id, pageSize, safeOffset]
    );
    const items = (rows as any[]).map((r) => ({
      id: Number(r.id),
      meetingId: r.meeting_id == null ? null : Number(r.meeting_id),
      meetingTitle: r.meeting_title ?? null,
      meetingCode: r.meeting_code ?? null,
      title: r.title,
      durationMs: Number(r.duration_ms),
      sizeBytes: Number(r.size_bytes),
      createdAt: new Date(r.created_at).toISOString(),
      url: `/api/recordings/${Number(r.id)}/download`,
    }));
    return { items, total, page, pageSize, totalPages };
  });

  // 下载（仅所有者）
  app.get("/recordings/:id/download", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "invalid_id" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const [rows] = await db.query(
      `SELECT * FROM recordings WHERE id = ? AND owner_user_id = ? LIMIT 1`,
      [id, user.id]
    );
    const r = (rows as any[])[0];
    if (!r) return reply.code(404).send({ error: "not_found" });
    const filePath = path.join(RECORDINGS_DIR, r.storage_path);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "file_missing" });
    }
    const stream = fs.createReadStream(filePath);
    reply.header(
      "Content-Type",
      r.storage_path.endsWith(".webm")
        ? "video/webm"
        : r.storage_path.endsWith(".mp4")
        ? "video/mp4"
        : "application/octet-stream"
    );
    reply.header(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(r.title)}.webm"`
    );
    return reply.send(stream);
  });

  // 删除（仅所有者）
  app.delete("/recordings/:id", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isFinite(id)) {
      return reply.code(400).send({ error: "invalid_id" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const [rows] = await db.query(
      `SELECT storage_path FROM recordings WHERE id = ? AND owner_user_id = ? LIMIT 1`,
      [id, user.id]
    );
    const r = (rows as any[])[0];
    if (!r) return reply.code(404).send({ error: "not_found" });
    try {
      const filePath = path.join(RECORDINGS_DIR, r.storage_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      console.error("remove recording file failed", err);
    }
    await db.query(`DELETE FROM recordings WHERE id = ?`, [id]);
    return { ok: true };
  });
}
