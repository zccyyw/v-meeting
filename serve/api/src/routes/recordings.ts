import type { FastifyInstance } from "fastify";
import { type Db, type ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

const RECORDINGS_DIR =
  process.env.RECORDINGS_DIR ?? path.join(process.cwd(), "data", "recordings");

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeTitle(title: string): string {
  const t = title.trim().slice(0, 100);
  return t.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "recording";
}

export async function recordingRoutes(
  app: FastifyInstance,
  db: Db,
  redis: Redis
) {
  ensureDir(RECORDINGS_DIR);

  // 上传录制文件（multipart：file + meta 字段）
  app.post("/recordings/upload", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    // 注意：不要先 req.file() 再 req.parts()，会把文件流消费掉导致永远落到 upload_failed
    const fields: Record<string, string> = {};
    let fileBuf: Buffer | null = null;
    let uploadFilename = "recording.webm";

    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (part.fieldname === "file") {
            fileBuf = await part.toBuffer();
            uploadFilename = part.filename || uploadFilename;
          } else {
            // 丢弃非预期文件字段，避免流卡住
            await part.toBuffer();
          }
        } else {
          fields[String(part.fieldname)] = String(part.value);
        }
      }
    } catch (err) {
      console.error("parse multipart failed", err);
      return reply.code(400).send({ error: "invalid_multipart" });
    }

    if (!fileBuf || fileBuf.length === 0) {
      return reply.code(400).send({ error: "no_file" });
    }

    try {
      const title = safeTitle(fields.title || "未命名录制");
      const meetingId = fields.meetingId ? Number(fields.meetingId) : null;
      const durationMs = Number(fields.durationMs) || 0;
      const ext = path.extname(uploadFilename) || ".webm";
      const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
      const filename = `${id}-${Date.now()}${ext}`;
      const storagePath = path.join(RECORDINGS_DIR, filename);
      fs.writeFileSync(storagePath, fileBuf);
      const sizeBytes = fs.statSync(storagePath).size;

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
          filename,
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
