import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { hashPassword } from "../auth.js";
import { generateMeetingCode } from "../meeting-code.js";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";
import { isUniqueViolation } from "../db.js";

type AppRow = {
  app_id: number | string;
  title: string;
  applicant_id: number | string;
  meeting_time: string;
  end_time: string | null;
  location: string | null;
  dept_count: number;
  priority: string;
  status: string;
  approver_id: number | string | null;
  approve_time: string | null;
  meeting_id: number | string | null;
  created_at: string;
  remark: string | null;
};

function mapRow(row: AppRow) {
  return {
    appId: Number(row.app_id),
    title: row.title,
    applicantId: Number(row.applicant_id),
    meetingTime: row.meeting_time,
    endTime: row.end_time ?? "",
    location: row.location ?? "",
    deptCount: row.dept_count,
    priority: row.priority,
    status: row.status,
    approverId: row.approver_id ? Number(row.approver_id) : null,
    approveTime: row.approve_time ?? "",
    meetingId: row.meeting_id ? Number(row.meeting_id) : null,
    createdAt: row.created_at,
    remark: row.remark ?? "",
  };
}

const CreateAppBody = z.object({
  title: z.string().min(1).max(200),
  meetingTime: z.string().min(1),
  endTime: z.string().optional(),
  location: z.string().max(255).optional().default(""),
  deptCount: z.number().int().min(0).default(0),
  priority: z.enum(["高", "中", "低"]).default("中"),
  remark: z.string().max(500).optional().default(""),
});

const ApproveBody = z.object({
  approved: z.boolean(),
  rejectReason: z.string().max(500).optional().default(""),
});

export async function meetingAppRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 提交会议申请 ──
  app.post("/meeting-applications", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const body = CreateAppBody.parse(req.body ?? {});

    const [result] = await db.query(
      `INSERT INTO meeting_applications
       (title, applicant_id, meeting_time, end_time, location, dept_count, priority, status, created_at, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ${nowSql(db)}, ?)`,
      [body.title, user.id, body.meetingTime, body.endTime || null, body.location, body.deptCount, body.priority, body.remark],
    );
    const appId = Number((result as ResultHeader).insertId);
    return reply.code(201).send({ appId, status: "pending" });
  });

  // ── 会议申请列表 ──
  app.get("/meeting-applications/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const q = req.query as {
      status?: string;
      priority?: string;
      page?: string;
      pageSize?: string;
    };
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 20);

    // 授权管理员看全部待审批的，普通用户看自己提交的
    const isApprover =
      user.roles.includes("admin") || user.roles.includes("auth_admin");

    let where = `WHERE 1=1`;
    const params: unknown[] = [];
    if (!isApprover) {
      where += ` AND applicant_id = ?`;
      params.push(user.id);
    }
    if (q.status) { where += ` AND status = ?`; params.push(q.status); }
    if (q.priority) { where += ` AND priority = ?`; params.push(q.priority); }

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM meeting_applications ${where}`,
      params,
    );
    const total = Number((countRows as { total: number | string }[])[0].total);

    const offset = (page - 1) * pageSize;
    // 按优先级排序：高 > 中 > 低
    const priorityOrder = `CASE priority WHEN '高' THEN 1 WHEN '中' THEN 2 WHEN '低' THEN 3 ELSE 4 END`;

    const [rows] = await db.query(
      `SELECT * FROM meeting_applications ${where} ORDER BY ${priorityOrder}, created_at DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const items = (rows as AppRow[]).map(mapRow);
    return { items, total, page, pageSize };
  });

  // ── 申请详情 ──
  app.get("/meeting-applications/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(
      `SELECT * FROM meeting_applications WHERE app_id = ? LIMIT 1`,
      [id],
    );
    const row = (rows as AppRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });

    // 非审批人只能看自己的
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("auth_admin") &&
      row.applicant_id !== user.id
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }

    return mapRow(row);
  });

  // ── 审批（仅授权管理员/超级管理员）──
  app.patch("/meeting-applications/:id/approve", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.roles.includes("auth_admin"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const body = ApproveBody.parse(req.body ?? {});

    const [existing] = await db.query(
      `SELECT * FROM meeting_applications WHERE app_id = ? LIMIT 1`,
      [id],
    );
    const row = (existing as AppRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.status !== "pending")
      return reply.code(400).send({ error: "already_processed" });

    const newStatus = body.approved ? "approved" : "rejected";

    await db.query(
      `UPDATE meeting_applications SET status = ?, approver_id = ?, approve_time = ${nowSql(db)}, remark = ? WHERE app_id = ?`,
      [newStatus, user.id, body.rejectReason, id],
    );

    return { appId: id, status: newStatus };
  });

  // ── 发起已批准的会议（创建 meeting）──
  app.post("/meeting-applications/:id/start", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const id = Number((req.params as { id: string }).id);
    const [existing] = await db.query(
      `SELECT * FROM meeting_applications WHERE app_id = ? LIMIT 1`,
      [id],
    );
    const row = (existing as AppRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.status !== "approved")
      return reply.code(400).send({ error: "not_approved" });

    // 仅申请人或管理员可发起
    if (row.applicant_id !== user.id && !user.roles.includes("admin"))
      return reply.code(403).send({ error: "forbidden" });

    // 创建会议
    let code = generateMeetingCode();
    let meetingId: number | null = null;

    for (let i = 0; i < 5; i++) {
      try {
        const [result] = await db.query(
          `INSERT INTO meetings
           (code, title, host_user_id, status, waiting_room_enabled, join_password_hash, scheduled_at)
           VALUES (?, ?, ?, 'live', 0, NULL, NULL)`,
          [code, row.title, user.id],
        );
        meetingId = Number((result as ResultHeader).insertId);
        break;
      } catch (e: unknown) {
        if (isUniqueViolation(e)) {
          code = generateMeetingCode();
          continue;
        }
        throw e;
      }
    }

    if (meetingId == null) {
      return reply.code(503).send({ error: "meeting_create_failed" });
    }

    // 更新申请记录中的 meeting_id
    await db.query(
      `UPDATE meeting_applications SET meeting_id = ? WHERE app_id = ?`,
      [meetingId, id],
    );

    // 生成主持人 join token
    const hostToken = randomBytes(32).toString("hex");
    const hostExpires = new Date(Date.now() + 24 * 3600 * 1000);
    await db.query(
      `INSERT INTO meeting_join_tokens (token, meeting_id, user_id, role, expires_at)
       VALUES (?, ?, ?, 'host', ?)`,
      [hostToken, meetingId, user.id, hostExpires],
    );

    return { meetingId, code, title: row.title, hostJoinToken: hostToken };
  });
}
