import type { FastifyInstance } from "fastify";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import type { Db } from "../db.js";
import { nowSql } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import {
  getSiteSettings,
  invalidateSiteSettings,
  type SiteSettings,
} from "../site-settings-cache.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRANDING_DIR = path.join(process.cwd(), "data", "branding");
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const MAX_BYTES = 600 * 1024;

const UpdateBody = z.object({
  name: z.string().max(100),
  logo: z.string().max(500),
  version: z.string().max(50),
  footerCopyright: z.string().max(500),
  footerShowVersion: z.boolean(),
  tabShowName: z.boolean(),
  tabTitle: z.string().max(200),
});

/** 结构化字段 → KV 键（写入时按此映射逐键 upsert） */
const KEY_MAP: Array<[keyof SiteSettings, string]> = [
  ["name", "site.name"],
  ["logo", "site.logo"],
  ["version", "site.version"],
  ["footerCopyright", "site.footer.copyright"],
  ["footerShowVersion", "site.footer.showVersion"],
  ["tabShowName", "site.tab.showName"],
  ["tabTitle", "site.tab.title"],
];

async function upsert(
  db: Db,
  key: string,
  value: string,
  by: string,
): Promise<void> {
  if (db.driver === "mysql") {
    await db.query(
      `INSERT INTO sys_site_settings
        (site_key, site_value, site_type, create_by, create_time, update_by, update_time)
       VALUES (?, ?, 'Y', ?, ${nowSql(db)}, ?, ${nowSql(db)})
       ON DUPLICATE KEY UPDATE
         site_value = VALUES(site_value),
         update_by = VALUES(update_by),
         update_time = ${nowSql(db)}`,
      [key, value, by, by],
    );
  } else if (db.driver === "postgres") {
    await db.query(
      `INSERT INTO sys_site_settings
        (site_key, site_value, site_type, create_by, update_by, update_time)
       VALUES ($1, $2, 'Y', $3, $3, NOW())
       ON CONFLICT (site_key) DO UPDATE SET
         site_value = EXCLUDED.site_value,
         update_by = EXCLUDED.update_by,
         update_time = NOW()`,
      [key, value, by],
    );
  } else {
    await db.query(
      `INSERT INTO sys_site_settings
        (site_key, site_value, site_type, create_by, update_by, update_time)
       VALUES (?, ?, 'Y', ?, ?, datetime('now'))
       ON CONFLICT(site_key) DO UPDATE SET
         site_value = excluded.site_value,
         update_by = excluded.update_by,
         update_time = datetime('now')`,
      [key, value, by, by],
    );
  }
}

export async function siteSettingsRoutes(
  app: FastifyInstance,
  db: Db,
  redis: Redis,
) {
  // ── 公开读取：供登录页 / 页签标题 / favicon 在会话建立前使用 ──
  app.get("/site-settings", async () => getSiteSettings(db));

  // ── 修改（admin 或 system:site:edit）──
  app.put("/site-settings", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.permissions.includes("system:site:edit")
    )
      return reply.code(403).send({ error: "forbidden" });

    const body = UpdateBody.parse(req.body ?? {});
    const by = user.username;
    for (const [field, key] of KEY_MAP) {
      const raw = body[field];
      const value = typeof raw === "boolean" ? (raw ? "Y" : "N") : String(raw);
      await upsert(db, key, value, by);
    }
    invalidateSiteSettings();
    return getSiteSettings(db);
  });

  // ── 上传 Logo（admin 或 system:site:edit）──
  app.post("/site-settings/logo", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.permissions.includes("system:site:edit")
    )
      return reply.code(403).send({ error: "forbidden" });

    let file: { filename: string; file: NodeJS.ReadableStream } | null = null;
    try {
      for await (const part of req.parts()) {
        if (part.type === "file") {
          file = part as unknown as { filename: string; file: NodeJS.ReadableStream };
          break;
        }
      }
    } catch (err) {
      const code = (err as { code?: string })?.code;
      return reply
        .code(code === "LIMIT_FILE_SIZE" ? 413 : 400)
        .send({ error: code === "LIMIT_FILE_SIZE" ? "file_too_large" : "invalid_multipart" });
    }
    if (!file) return reply.code(400).send({ error: "no_file" });

    const ext = path.extname(file.filename || "").toLowerCase();
    if (!ALLOWED_EXT.has(ext)) {
      for await (const _c of file.file) {
        /* drain */
      }
      return reply.code(415).send({ error: "unsupported_type" });
    }

    await fs.promises.mkdir(BRANDING_DIR, { recursive: true });
    const tmp = path.join(BRANDING_DIR, `${crypto.randomUUID()}.part`);
    const out = fs.createWriteStream(tmp);
    let size = 0;
    let exceeded = false;
    try {
      for await (const chunk of file.file) {
        size += (chunk as Buffer).length;
        if (size > MAX_BYTES) {
          exceeded = true;
          break;
        }
        out.write(chunk);
      }
      await new Promise<void>((res, rej) =>
        out.end((e: Error | null) => (e ? rej(e) : res())),
      );
    } catch {
      await fs.promises.unlink(tmp).catch(() => {});
      return reply.code(400).send({ error: "upload_failed" });
    }
    if (exceeded) {
      await fs.promises.unlink(tmp).catch(() => {});
      return reply.code(413).send({ error: "file_too_large" });
    }

    const finalName = `${crypto.randomUUID()}${ext}`;
    await fs.promises.rename(tmp, path.join(BRANDING_DIR, finalName));
    // 前端经 /api 前缀访问（caddy 去掉 /api 后落到本路由 /branding/:file）
    return reply.code(201).send({ url: `/branding/${finalName}` });
  });

  // ── 公开：流式返回 branding 图片 ──
  app.get("/branding/:file", async (req, reply) => {
    const file = (req.params as { file: string }).file;
    // 防目录穿越
    if (!/^[A-Za-z0-9._-]+$/.test(file)) {
      return reply.code(400).send({ error: "bad_name" });
    }
    const filePath = path.join(BRANDING_DIR, file);
    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "not_found" });
    }
    const ext = path.extname(file).toLowerCase();
    const mime =
      ext === ".svg" ? "image/svg+xml" : ext === ".png" ? "image/png" : "image/jpeg";
    reply.header("Content-Type", mime);
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(fs.createReadStream(filePath));
  });
}
