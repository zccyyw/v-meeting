import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { hashPassword } from "../auth.js";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";
import { loadPasswordPolicy, validatePassword } from "../password-policy.js";
import { decryptPassword } from "@meeting/shared";

type ApprovalRow = {
  approval_id: number | string;
  request_type: string;
  target_user_id: number | string | null;
  requester_id: number | string;
  requester_data: string | null;
  status: string;
  approver_id: number | string | null;
  approve_time: string | null;
  reject_reason: string | null;
  create_time: string;
};

function mapRow(row: ApprovalRow) {
  return {
    approvalId: Number(row.approval_id),
    requestType: row.request_type,
    targetUserId: row.target_user_id ? Number(row.target_user_id) : null,
    requesterId: Number(row.requester_id),
    requesterData: row.requester_data ? JSON.parse(row.requester_data) : null,
    status: row.status,
    approverId: row.approver_id ? Number(row.approver_id) : null,
    approveTime: row.approve_time ?? "",
    rejectReason: row.reject_reason ?? "",
    createTime: row.create_time,
  };
}

const CreateApprovalBody = z.object({
  requestType: z.enum(["create", "update", "delete", "resetPwd"]),
  targetUserId: z.number().optional().nullable(),
  requestData: z.record(z.unknown()).optional().default({}),
});

const ApproveBody = z.object({
  approved: z.boolean(),
  rejectReason: z.string().max(500).optional().default(""),
});

export async function userApprovalRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 提交审批申请（系统管理员）──
  app.post("/sys-user-approval", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    // 仅系统管理员和超级管理员可提交申请
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("sys_admin") &&
      !user.permissions.includes("system:user:add")
    )
      return reply.code(403).send({ error: "forbidden" });

    const body = CreateApprovalBody.parse(req.body ?? {});

    // 如果是 create/resetPwd，解密并校验密码策略
    if ((body.requestType === "create" || body.requestType === "resetPwd") && body.requestData?.password) {
      const decPassword = await decryptPassword(body.requestData.password as string);
      body.requestData.password = decPassword;
      const policy = await loadPasswordPolicy(db);
      const pwdValidation = validatePassword(decPassword, policy);
      if (!pwdValidation.valid) {
        return reply.code(400).send({ error: "password_policy_violation", details: pwdValidation.errors });
      }
    }

    try {
      const [result] = await db.query(
        `INSERT INTO sys_user_approval (request_type, target_user_id, requester_id, requester_data, status, create_time)
         VALUES (?, ?, ?, ?, 'pending', ${nowSql(db)})`,
        [body.requestType, body.targetUserId ?? null, user.id, JSON.stringify(body.requestData)],
      );
      const approvalId = Number((result as ResultHeader).insertId);
      return reply.code(201).send({ approvalId, status: "pending" });
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "SQLITE_CONSTRAINT" || err.code === "ER_DUP_ENTRY" || err.code === "23505") {
        return reply.code(409).send({ error: "duplicate_request" });
      }
      throw e;
    }
  });

  // ── 审批列表 ──
  app.get("/sys-user-approval/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    // 授权管理员看待审批的，系统管理员看自己提交的
    const isApprover =
      user.roles.includes("admin") || user.roles.includes("auth_admin");

    const q = req.query as { status?: string; page?: string; pageSize?: string };
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 20);

    let where = `WHERE 1=1`;
    const params: unknown[] = [];
    if (!isApprover) {
      // 系统管理员只看自己提交的
      where += ` AND requester_id = ?`;
      params.push(user.id);
    }
    if (q.status) { where += ` AND status = ?`; params.push(q.status); }

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM sys_user_approval ${where}`,
      params,
    );
    const total = Number((countRows as { total: number | string }[])[0].total);

    const offset = (page - 1) * pageSize;
    const [rows] = await db.query(
      `SELECT * FROM sys_user_approval ${where} ORDER BY approval_id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const items = (rows as ApprovalRow[]).map(mapRow);
    return { items, total, page, pageSize };
  });

  // ── 审批详情 ──
  app.get("/sys-user-approval/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(
      `SELECT * FROM sys_user_approval WHERE approval_id = ? LIMIT 1`,
      [id],
    );
    const row = (rows as ApprovalRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });

    // 系统管理员只能看自己的申请
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("auth_admin") &&
      row.requester_id !== user.id
    ) {
      return reply.code(403).send({ error: "forbidden" });
    }

    return mapRow(row);
  });

  // ── 审批操作（授权管理员）──
  app.patch("/sys-user-approval/:id/approve", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    // 仅授权管理员和超级管理员可审批
    if (!user.roles.includes("admin") && !user.roles.includes("auth_admin"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const body = ApproveBody.parse(req.body ?? {});

    const [existing] = await db.query(
      `SELECT * FROM sys_user_approval WHERE approval_id = ? LIMIT 1`,
      [id],
    );
    const row = (existing as ApprovalRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (row.status !== "pending")
      return reply.code(400).send({ error: "already_processed" });

    const newStatus = body.approved ? "approved" : "rejected";

    // 更新审批状态
    await db.query(
      `UPDATE sys_user_approval SET status = ?, approver_id = ?, approve_time = ${nowSql(db)}, reject_reason = ? WHERE approval_id = ?`,
      [newStatus, user.id, body.rejectReason, id],
    );

    // 如果审批通过，执行实际操作
    if (body.approved) {
      const requestData = row.requester_data ? JSON.parse(row.requester_data) : {};
      const requestType = row.request_type;

      try {
        if (requestType === "create") {
          const passwordHash = await hashPassword(requestData.password as string);
          const [result] = await db.query(
            `INSERT INTO sys_user (dept_id, user_name, nick_name, user_type, email, phonenumber, sex, avatar, password, status, del_flag, create_by, create_time, remark, pwd_update_date)
             VALUES (?, ?, ?, '00', ?, ?, ?, '', ?, ?, '0', ?, ${nowSql(db)}, ?, ${nowSql(db)})`,
            [
              requestData.deptId ?? null,
              requestData.userName,
              requestData.nickName,
              requestData.email ?? "",
              requestData.phonenumber ?? "",
              requestData.sex ?? "0",
              passwordHash,
              requestData.status ?? "0",
              user.username,
              requestData.remark ?? "",
            ],
          );
          const newUserId = Number((result as ResultHeader).insertId);
          if (requestData.roleIds && Array.isArray(requestData.roleIds)) {
            for (const roleId of requestData.roleIds) {
              await db.query(
                `INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)`,
                [newUserId, roleId],
              );
            }
          }
        } else if (requestType === "update" && row.target_user_id) {
          const targetId = Number(row.target_user_id);
          const sets: string[] = [];
          const params: unknown[] = [];
          if (requestData.nickName !== undefined) { sets.push("nick_name = ?"); params.push(requestData.nickName); }
          if (requestData.email !== undefined) { sets.push("email = ?"); params.push(requestData.email); }
          if (requestData.phonenumber !== undefined) { sets.push("phonenumber = ?"); params.push(requestData.phonenumber); }
          if (requestData.sex !== undefined) { sets.push("sex = ?"); params.push(requestData.sex); }
          if (requestData.status !== undefined) { sets.push("status = ?"); params.push(requestData.status); }
          if (requestData.deptId !== undefined) { sets.push("dept_id = ?"); params.push(requestData.deptId); }
          if (sets.length > 0) {
            sets.push(`update_by = ?`); params.push(user.username);
            sets.push(`update_time = ${nowSql(db)}`);
            await db.query(`UPDATE sys_user SET ${sets.join(", ")} WHERE user_id = ?`, [...params, targetId]);
          }
          if (requestData.roleIds !== undefined && Array.isArray(requestData.roleIds)) {
            await db.query(`DELETE FROM sys_user_role WHERE user_id = ?`, [targetId]);
            for (const roleId of requestData.roleIds) {
              await db.query(`INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)`, [targetId, roleId]);
            }
          }
        } else if (requestType === "delete" && row.target_user_id) {
          const targetId = Number(row.target_user_id);
          await db.query(
            `UPDATE sys_user SET del_flag = '2', update_by = ?, update_time = ${nowSql(db)} WHERE user_id = ?`,
            [user.username, targetId],
          );
          await db.query(`DELETE FROM sys_user_role WHERE user_id = ?`, [targetId]);
        } else if (requestType === "resetPwd" && row.target_user_id) {
          const targetId = Number(row.target_user_id);
          const passwordHash = await hashPassword(requestData.password as string);
          await db.query(
            `UPDATE sys_user SET password = ?, pwd_update_date = ${nowSql(db)}, update_by = ?, update_time = ${nowSql(db)} WHERE user_id = ?`,
            [passwordHash, user.username, targetId],
          );
        }
      } catch (e) {
        // 执行失败，标记审批状态为执行失败
        await db.query(
          `UPDATE sys_user_approval SET status = 'execution_failed', reject_reason = ? WHERE approval_id = ?`,
          [String(e), id],
        );
        return reply.code(500).send({ error: "execution_failed", detail: String(e) });
      }
    }

    return { approvalId: id, status: newStatus };
  });
}
