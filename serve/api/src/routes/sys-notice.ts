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

type TargetRow = {
  target_type: string;
  target_id: number | string;
  name: string | null;
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
    // 接收范围计数：-1 = 全员（type=2 或无 target 的存量 type=1）；管理端列表用
    targetCount: -1 as number,
  };
}

/** type=1（通知）时接收范围必填：部门与用户至少一项（type=2 全员，忽略 targets） */
const TargetSchema = z.object({
  targetUserIds: z.array(z.number().int()).optional().default([]),
  targetDeptIds: z.array(z.number().int()).optional().default([]),
});

const CreateBody = TargetSchema.extend({
  noticeTitle: z.string().min(1).max(50),
  noticeType: z.enum(["1", "2"]),
  noticeContent: z.string().optional().default(""),
  status: z.enum(["0", "1"]).default("0"),
  remark: z.string().max(255).optional().default(""),
}).superRefine((val, ctx) => {
  if (
    val.noticeType === "1" &&
    val.targetUserIds.length === 0 &&
    val.targetDeptIds.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetUserIds"],
      message: "target_required",
    });
  }
});

const UpdateBody = TargetSchema.extend({
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

/** 覆盖式重写通知的接收范围（管理端保存/编辑时调用） */
async function replaceTargets(
  db: Db,
  noticeId: number,
  targetUserIds: number[],
  targetDeptIds: number[],
): Promise<void> {
  await db.query(`DELETE FROM sys_notice_target WHERE notice_id = ?`, [noticeId]);
  const rows: unknown[] = [];
  const values: string[] = [];
  for (const uid of targetUserIds) {
    values.push(`(?, 'user', ?, ${nowSql(db)})`);
    rows.push(noticeId, uid);
  }
  for (const did of targetDeptIds) {
    values.push(`(?, 'dept', ?, ${nowSql(db)})`);
    rows.push(noticeId, did);
  }
  if (values.length === 0) return;
  await db.query(
    `INSERT INTO sys_notice_target (notice_id, target_type, target_id, create_time)
     VALUES ${values.join(", ")}`,
    rows,
  );
}

async function deleteNoticeCascade(db: Db, noticeId: number): Promise<void> {
  await db.query(`DELETE FROM sys_notice_target WHERE notice_id = ?`, [noticeId]);
  await db.query(`DELETE FROM sys_notice_read WHERE notice_id = ?`, [noticeId]);
}

/** 可见通知的公共 WHERE（C 端）：全员 / 无 target 兼容 / 按部门或用户定向 */
function visibleWhere(uid: number): string {
  return `n.status = '0' AND (
    n.notice_type = '2'
    OR NOT EXISTS(SELECT 1 FROM sys_notice_target t WHERE t.notice_id = n.notice_id)
    OR EXISTS(
      SELECT 1 FROM sys_notice_target t
      WHERE t.notice_id = n.notice_id AND (
        (t.target_type = 'user' AND t.target_id = ${uid})
        OR (t.target_type = 'dept' AND t.target_id = (SELECT dept_id FROM sys_user WHERE user_id = ${uid}))
      )
    )
  )`;
}

/** 按 driver 生成已读标记的幂等写入 */
async function markRead(db: Db, noticeId: number, userId: number): Promise<void> {
  if (db.driver === "sqlite") {
    await db.query(
      `INSERT OR IGNORE INTO sys_notice_read (notice_id, user_id, read_time) VALUES (?, ?, ${nowSql(db)})`,
      [noticeId, userId],
    );
  } else if (db.driver === "postgres") {
    await db.query(
      `INSERT INTO sys_notice_read (notice_id, user_id, read_time) VALUES (?, ?, ${nowSql(db)}) ON CONFLICT DO NOTHING`,
      [noticeId, userId],
    );
  } else {
    await db.query(
      `INSERT IGNORE INTO sys_notice_read (notice_id, user_id, read_time) VALUES (?, ?, ${nowSql(db)})`,
      [noticeId, userId],
    );
  }
}

export async function noticeRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（分页，管理端）──
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

    // 接收范围计数：type=2 全员；type=1 按 target 数（无 target 视为全员，兼容存量）
    for (const item of items) {
      if (item.noticeType === "2") {
        item.targetCount = -1; // -1 表示全员
        continue;
      }
      const [cntRows] = await db.query(
        `SELECT COUNT(*) AS c FROM sys_notice_target WHERE notice_id = ?`,
        [item.noticeId],
      );
      const c = Number((cntRows as { c: number | string }[])[0].c);
      item.targetCount = c === 0 ? -1 : c;
    }
    return { items, total, page, pageSize };
  });

  // ── 详情（管理端，含接收范围回显）──
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

    const [targetRows] = await db.query(
      `SELECT t.target_type, t.target_id,
              COALESCE(u.nick_name, u2.display_name, d.dept_name, '') AS name
       FROM sys_notice_target t
       LEFT JOIN sys_user u ON t.target_type = 'user' AND u.user_id = t.target_id
       LEFT JOIN users u2 ON t.target_type = 'user' AND u2.id = t.target_id
       LEFT JOIN sys_dept d ON t.target_type = 'dept' AND d.dept_id = t.target_id
       WHERE t.notice_id = ?`,
      [id],
    );
    const targets = (targetRows as TargetRow[]).map((t) => ({
      targetType: t.target_type,
      targetId: Number(t.target_id),
      name: t.name ?? "",
    }));

    // 接收用户列表（用户级展开 + 已读标记）：
    // - 有 target：部门展开为该部门全部用户 ∪ 直选用户，去重
    // - 无 target（全员公告 / 存量 type=1）：全部 sys_user
    const [cntRows] = await db.query(
      `SELECT COUNT(*) AS c FROM sys_notice_target WHERE notice_id = ?`,
      [id],
    );
    const hasTargets = Number((cntRows as { c: number | string }[])[0].c) > 0;
    const [recRows] = hasTargets
      ? await db.query(
          `SELECT u.user_id,
                  COALESCE(u.nick_name, u.user_name, '') AS name,
                  COALESCE(d.dept_name, '') AS dept_name,
                  MAX(CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END) AS read
           FROM sys_notice_target t
           JOIN sys_user u ON (
                (t.target_type = 'user' AND u.user_id = t.target_id)
             OR (t.target_type = 'dept' AND u.dept_id = t.target_id)
           )
           LEFT JOIN sys_dept d ON d.dept_id = u.dept_id
           LEFT JOIN sys_notice_read r ON r.notice_id = t.notice_id AND r.user_id = u.user_id
           WHERE t.notice_id = ?
           GROUP BY u.user_id
           ORDER BY read ASC, u.user_id ASC`,
          [id],
        )
      : await db.query(
          `SELECT u.user_id,
                  COALESCE(u.nick_name, u.user_name, '') AS name,
                  COALESCE(d.dept_name, '') AS dept_name,
                  CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS read
           FROM sys_user u
           LEFT JOIN sys_dept d ON d.dept_id = u.dept_id
           LEFT JOIN sys_notice_read r ON r.notice_id = ? AND r.user_id = u.user_id
           ORDER BY read ASC, u.user_id ASC`,
          [id],
        );
    const recipients = (recRows as { user_id: number | string; name: string; dept_name: string; read: number | string }[]).map((r) => ({
      userId: Number(r.user_id),
      name: r.name,
      deptName: r.dept_name,
      read: Number(r.read),
    }));
    const readCount = recipients.filter((r) => r.read === 1).length;

    return {
      ...mapRow(row),
      targetUserIds: targets.filter((t) => t.targetType === "user").map((t) => t.targetId),
      targetDeptIds: targets.filter((t) => t.targetType === "dept").map((t) => t.targetId),
      targets,
      recipients,
      readCount,
      totalCount: recipients.length,
    };
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
    if (body.noticeType === "1") {
      await replaceTargets(db, newId, body.targetUserIds, body.targetDeptIds);
    }
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

    if (body.noticeType === "1") {
      const [cntRows] = await db.query(
        `SELECT COUNT(*) AS c FROM sys_notice_target WHERE notice_id = ?`,
        [id],
      );
      const hasTargets = Number((cntRows as { c: number | string }[])[0].c) > 0;
      const providesTargets =
        body.targetUserIds.length > 0 || body.targetDeptIds.length > 0;
      if (!hasTargets && !providesTargets) {
        return reply.code(400).send({ error: "target_required" });
      }
    }

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
    if (body.noticeType === "1") {
      await replaceTargets(db, id, body.targetUserIds, body.targetDeptIds);
    } else if (body.noticeType === "2") {
      // 改为全员公告：清空定向范围
      await db.query(`DELETE FROM sys_notice_target WHERE notice_id = ?`, [id]);
    }
    const [rows] = await db.query(`SELECT * FROM sys_notice WHERE notice_id = ? LIMIT 1`, [id]);
    return mapRow((rows as NoticeRow[])[0]);
  });

  // ── 删除（级联清理接收范围与已读）──
  app.delete("/sys-notice/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:notice:remove"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    await deleteNoticeCascade(db, id);
    await db.query(`DELETE FROM sys_notice WHERE notice_id = ?`, [id]);
    return reply.code(204).send();
  });

  // ── C 端：我的通知（全员公告 + 定向给我的通知），登录即可 ──
  app.get("/sys-notice/my", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const uid = Number(user.id);

    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? 1);
    const pageSize = Math.min(Number(q.pageSize ?? 20), 50);
    const vis = visibleWhere(uid);

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN r.user_id IS NULL THEN 1 ELSE 0 END) AS unread
       FROM sys_notice n
       LEFT JOIN sys_notice_read r ON r.notice_id = n.notice_id AND r.user_id = ${uid}
       WHERE ${vis}`,
    );
    const cnt = (countRows as { total: number | string; unread: number | string | null }[])[0];
    const total = Number(cnt.total);
    const unreadCount = Number(cnt.unread ?? 0);

    const [rows] = await db.query(
      `SELECT n.notice_id, n.notice_title, n.notice_type, n.create_time,
              CASE WHEN r.user_id IS NULL THEN 0 ELSE 1 END AS read
       FROM sys_notice n
       LEFT JOIN sys_notice_read r ON r.notice_id = n.notice_id AND r.user_id = ${uid}
       WHERE ${vis}
       ORDER BY n.notice_id DESC ${limitClause(db, page, pageSize)}`,
    );
    const items = (rows as { notice_id: number | string; notice_title: string; notice_type: string; create_time: string; read: number }[]).map((r) => ({
      noticeId: Number(r.notice_id),
      noticeTitle: r.notice_title,
      noticeType: r.notice_type,
      createTime: r.create_time,
      read: Number(r.read),
    }));
    return { items, total, unreadCount, page, pageSize };
  });

  // ── C 端：通知详情（可见性校验 + 标记已读）──
  app.get("/sys-notice/my/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const uid = Number(user.id);

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(
      `SELECT n.* FROM sys_notice n WHERE n.notice_id = ? AND ${visibleWhere(uid)} LIMIT 1`,
      [id],
    );
    const row = (rows as NoticeRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });

    await markRead(db, id, uid);
    return mapRow(row);
  });
}
