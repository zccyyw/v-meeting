import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";

type NoticeRow = {
  notice_id: number | string;
  notice_title: string;
  notice_type: string;
  notice_content: string | null;
  status: string;
  create_by: string | null;
  create_time: string;
  update_by: string | null;
  update_time: string;
  remark: string | null;
};

function mapRow(row: NoticeRow) {
  return {
    noticeId: Number(row.notice_id),
    noticeTitle: row.notice_title,
    noticeType: row.notice_type,
    noticeContent: row.notice_content ?? "",
    status: row.status,
    createBy: row.create_by ?? "",
    createTime: row.create_time,
    updateBy: row.update_by ?? "",
    updateTime: row.update_time,
    remark: row.remark ?? "",
  };
}

const CreateBody = z.object({
  noticeTitle: z.string().min(1).max(50),
  noticeType: z.enum(["1", "2"]),
  noticeContent: z.string().optional().default(""),
  status: z.enum(["0", "1"]).default("0"),
  remark: z.string().max(255).optional().default(""),
});

const UpdateBody = z.object({
  noticeTitle: z.string().min(1).max(50).optional(),
  noticeType: z.enum(["1", "2"]).optional(),
  noticeContent: z.string().optional(),
  status: z.enum(["0", "1"]).optional(),
  remark: z.string().max(255).optional(),
});

function limitClause(db: Db, page: number, pageSize: number): string {
  const offset = (page - 1) * pageSize;
  return `LIMIT ${pageSize} OFFSET ${offset}`;
}

export async function noticeRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（分页）──
  app.get("/sys-notice/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:notice:list"))
      return reply.code(403).send({ error: "forbidden" });

    const q = req.query as { noticeTitle?: string; noticeType?: string; status?: string; page?: string; pageSize?: string };
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 20);

    let where = `WHERE 1=1`;
    const params: unknown[] = [];
    if (q.noticeTitle) { where += ` AND notice_title LIKE ?`; params.push(`%${q.noticeTitle}%`); }
    if (q.noticeType) { where += ` AND notice_type = ?`; params.push(q.noticeType); }
    if (q.status) { where += ` AND status = ?`; params.push(q.status); }

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM sys_notice ${where}`, params);
    const total = Number((countRows as { total: number | string }[])[0].total);

    const [rows] = await db.query(
      `SELECT * FROM sys_notice ${where} ORDER BY notice_id ${limitClause(db, page, pageSize)}`,
      params,
    );
    const items = (rows as NoticeRow[]).map(mapRow);
    return { items, total, page, pageSize };
  });

  // ── 详情 ──
  app.get("/sys-notice/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:notice:query"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(`SELECT * FROM sys_notice WHERE notice_id = ? LIMIT 1`, [id]);
    const row = (rows as NoticeRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    return mapRow(row);
  });

  // ── 新增 ──
  app.post("/sys-notice", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:notice:add"))
      return reply.code(403).send({ error: "forbidden" });

    const body = CreateBody.parse(req.body ?? {});
    const [result] = await db.query(
      `INSERT INTO sys_notice (notice_title, notice_type, notice_content, status, create_by, create_time, remark)
       VALUES (?, ?, ?, ?, ?, ${nowSql(db)}, ?)`,
      [body.noticeTitle, body.noticeType, body.noticeContent, body.status, user.username, body.remark],
    );
    const newId = Number((result as ResultHeader).insertId);
    const [rows] = await db.query(`SELECT * FROM sys_notice WHERE notice_id = ? LIMIT 1`, [newId]);
    return reply.code(201).send(mapRow((rows as NoticeRow[])[0]));
  });

  // ── 修改 ──
  app.patch("/sys-notice/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:notice:edit"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const body = UpdateBody.parse(req.body ?? {});
    if (Object.keys(body).length === 0) return reply.code(400).send({ error: "empty_patch" });

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.noticeTitle !== undefined) { sets.push("notice_title = ?"); params.push(body.noticeTitle); }
    if (body.noticeType !== undefined) { sets.push("notice_type = ?"); params.push(body.noticeType); }
    if (body.noticeContent !== undefined) { sets.push("notice_content = ?"); params.push(body.noticeContent); }
    if (body.status !== undefined) { sets.push("status = ?"); params.push(body.status); }
    if (body.remark !== undefined) { sets.push("remark = ?"); params.push(body.remark); }
    sets.push("update_by = ?"); params.push(user.username);
    sets.push(`update_time = ${nowSql(db)}`);

    await db.query(`UPDATE sys_notice SET ${sets.join(", ")} WHERE notice_id = ?`, [...params, id]);
    const [rows] = await db.query(`SELECT * FROM sys_notice WHERE notice_id = ? LIMIT 1`, [id]);
    return mapRow((rows as NoticeRow[])[0]);
  });

  // ── 删除 ──
  app.delete("/sys-notice/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:notice:remove"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    await db.query(`DELETE FROM sys_notice WHERE notice_id = ?`, [id]);
    return reply.code(204).send();
  });
}
