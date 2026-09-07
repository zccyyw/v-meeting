import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { hashPassword } from "../auth.js";
import { loadSessionUser } from "../session-user.js";
import { nowSql, hasSysUser } from "../sql-utils.js";
import { loadPasswordPolicy, validatePassword } from "../password-policy.js";
import { decryptPassword } from "@meeting/shared";

type SysUserRow = {
  user_id: number | string;
  dept_id: number | string | null;
  user_name: string;
  nick_name: string;
  user_type: string;
  email: string | null;
  phonenumber: string | null;
  sex: string;
  avatar: string | null;
  status: string;
  del_flag: string;
  login_ip: string | null;
  login_date: string | null;
  create_time: string;
  update_time: string;
  remark: string | null;
};

function mapRow(row: SysUserRow, roleIds: number[] = []) {
  return {
    userId: Number(row.user_id),
    deptId: row.dept_id ? Number(row.dept_id) : null,
    userName: row.user_name,
    nickName: row.nick_name,
    userType: row.user_type,
    email: row.email ?? "",
    phonenumber: row.phonenumber ?? "",
    sex: row.sex,
    avatar: row.avatar ?? "",
    status: row.status,
    delFlag: row.del_flag,
    loginIp: row.login_ip ?? "",
    loginDate: row.login_date ?? "",
    createTime: row.create_time,
    updateTime: row.update_time,
    remark: row.remark ?? "",
    roleIds,
  };
}

const ListQuery = z.object({
  deptId: z.coerce.number().optional(),
  userName: z.string().optional(),
  phonenumber: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateUserBody = z.object({
  deptId: z.number().optional().nullable(),
  userName: z.string().min(3).max(30),
  nickName: z.string().min(1).max(30),
  password: z.string().min(1).max(128),
  email: z.string().max(50).optional().default(""),
  phonenumber: z.string().max(11).optional().default(""),
  sex: z.enum(["0", "1", "2"]).default("0"),
  status: z.enum(["0", "1"]).default("0"),
  remark: z.string().max(500).optional().default(""),
  roleIds: z.array(z.number()).optional().default([]),
});

const UpdateUserBody = z.object({
  deptId: z.number().optional().nullable(),
  nickName: z.string().min(1).max(30).optional(),
  password: z.string().min(1).max(128).optional(),
  email: z.string().max(50).optional(),
  phonenumber: z.string().max(11).optional(),
  sex: z.enum(["0", "1", "2"]).optional(),
  status: z.enum(["0", "1"]).optional(),
  remark: z.string().max(500).optional(),
  roleIds: z.array(z.number()).optional(),
});

/** 获取用户的角色ID列表 */
async function getUserRoleIds(db: Db, userId: number): Promise<number[]> {
  const [rows] = await db.query(
    `SELECT role_id FROM sys_user_role WHERE user_id = ?`,
    [userId],
  );
  return (rows as { role_id: number }[]).map((r) => Number(r.role_id));
}

/** 更新用户角色关联 */
async function updateUserRoles(db: Db, userId: number, roleIds: number[]): Promise<void> {
  await db.query(`DELETE FROM sys_user_role WHERE user_id = ?`, [userId]);
  for (const roleId of roleIds) {
    await db.query(
      `INSERT INTO sys_user_role (user_id, role_id) VALUES (?, ?)`,
      [userId, roleId],
    );
  }
}

/** 检查是否是最后一个 admin 角色用户 */
async function isLastAdmin(db: Db, userId: number): Promise<boolean> {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM sys_user_role ur
     JOIN sys_role r ON ur.role_id = r.role_id
     JOIN sys_user u ON ur.user_id = u.user_id
     WHERE r.role_key = 'admin' AND r.status = '0' AND r.del_flag = '0'
       AND u.status = '0' AND u.del_flag = '0' AND ur.user_id <> ?`,
    [userId],
  );
  return Number((rows as { cnt: number | string }[])[0].cnt) === 0;
}

export async function sysUserRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（分页 + 部门筛选）──
  app.get("/sys-user/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:list"))
      return reply.code(403).send({ error: "forbidden" });

    const q = ListQuery.parse(req.query ?? {});
    const offset = (q.page - 1) * q.pageSize;

    let where = `WHERE u.del_flag = '0'`;
    const params: unknown[] = [];
    // system 隐藏用户：对非 system 用户不可见
    // 始终屏蔽 system 和 sysadmin（不影响其登录和系统操作）
    where += ` AND u.user_name NOT IN ('system', 'sysadmin')`;
    if (q.deptId) { where += ` AND u.dept_id = ?`; params.push(q.deptId); }
    if (q.userName) { where += ` AND (u.user_name LIKE ? OR u.nick_name LIKE ?)`; params.push(`%${q.userName}%`, `%${q.userName}%`); }
    if (q.phonenumber) { where += ` AND u.phonenumber LIKE ?`; params.push(`%${q.phonenumber}%`); }
    if (q.status) { where += ` AND u.status = ?`; params.push(q.status); }

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM sys_user u ${where}`,
      params,
    );
    const total = Number((countRows as { total: number | string }[])[0].total);

    const [rows] = await db.query(
      `SELECT u.* FROM sys_user u ${where} ORDER BY u.user_id LIMIT ? OFFSET ?`,
      [...params, q.pageSize, offset],
    );
    const users = rows as SysUserRow[];

    // 批量获取用户角色
    const items = await Promise.all(
      users.map(async (row) => mapRow(row, await getUserRoleIds(db, Number(row.user_id)))),
    );

    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  // ── 简单列表（仅需登录，用于群组成员选择）──
  app.get("/sys-user/simple-list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const q = ListQuery.parse(req.query ?? {});
    const offset = (q.page - 1) * q.pageSize;

    let where = `WHERE u.del_flag = '0' AND u.status = '0'`;
    const params: unknown[] = [];
    // 始终屏蔽 system 和 sysadmin（不影响其登录和系统操作）
    where += ` AND u.user_name NOT IN ('system', 'sysadmin')`;
    if (q.userName) {
      where += ` AND (u.user_name LIKE ? OR u.nick_name LIKE ?)`;
      params.push(`%${q.userName}%`, `%${q.userName}%`);
    }

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM sys_user u ${where}`,
      params,
    );
    const total = Number((countRows as { total: number | string }[])[0].total);

    const [rows] = await db.query(
      `SELECT u.user_id, u.user_name, u.nick_name FROM sys_user u ${where} ORDER BY u.user_id LIMIT ? OFFSET ?`,
      [...params, q.pageSize, offset],
    );
    const users = rows as { user_id: number; user_name: string; nick_name: string }[];

    return {
      items: users.map((r) => ({
        userId: Number(r.user_id),
        userName: r.user_name,
        nickName: r.nick_name,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  // ── 详情 ──
  app.get("/sys-user/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:query"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(`SELECT * FROM sys_user WHERE user_id = ? LIMIT 1`, [id]);
    const row = (rows as SysUserRow[])[0];
    if (!row || row.del_flag === "2") return reply.code(404).send({ error: "not_found" });
    return mapRow(row, await getUserRoleIds(db, id));
  });

  // ── 新增 ──
  app.post("/sys-user", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:add"))
      return reply.code(403).send({ error: "forbidden" });

    const bodyRaw = CreateUserBody.parse(req.body ?? {});
    // 解密前端传来的密码
    const password = await decryptPassword(bodyRaw.password);
    const body = { ...bodyRaw, password };

    // 密码策略校验
    const policy = await loadPasswordPolicy(db);
    const pwdValidation = validatePassword(body.password, policy);
    if (!pwdValidation.valid) {
      return reply.code(400).send({ error: "password_policy_violation", details: pwdValidation.errors });
    }

    const passwordHash = await hashPassword(body.password);

    try {
      const [result] = await db.query(
        `INSERT INTO sys_user (dept_id, user_name, nick_name, user_type, email, phonenumber, sex, avatar, password, status, del_flag, create_by, create_time, remark)
         VALUES (?, ?, ?, '00', ?, ?, ?, '', ?, ?, '0', ?, ${nowSql(db)}, ?)`,
        [body.deptId ?? null, body.userName, body.nickName, body.email, body.phonenumber,
         body.sex, passwordHash, body.status, user.username, body.remark],
      );
      const userId = Number((result as ResultHeader).insertId);

      // 分配角色
      if (body.roleIds.length > 0) {
        await updateUserRoles(db, userId, body.roleIds);
      }

      const [rows] = await db.query(`SELECT * FROM sys_user WHERE user_id = ? LIMIT 1`, [userId]);
      return reply.code(201).send(mapRow((rows as SysUserRow[])[0], body.roleIds));
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "ER_DUP_ENTRY" || err.code === "23505") {
        return reply.code(409).send({ error: "username_taken" });
      }
      throw e;
    }
  });

  // ── 修改 ──
  app.patch("/sys-user/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:edit"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const body = UpdateUserBody.parse(req.body ?? {});
    if (Object.keys(body).length === 0) return reply.code(400).send({ error: "empty_patch" });

    const [existing] = await db.query(`SELECT * FROM sys_user WHERE user_id = ? LIMIT 1`, [id]);
    const target = (existing as SysUserRow[])[0];
    if (!target || target.del_flag === "2") return reply.code(404).send({ error: "not_found" });

    // 检查是否移除最后一个 admin
    if (body.status === "1" || (body.roleIds !== undefined && !body.roleIds.includes(1))) {
      if (await isLastAdmin(db, id)) {
        return reply.code(403).send({ error: "last_admin" });
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.deptId !== undefined) { sets.push("dept_id = ?"); params.push(body.deptId); }
    if (body.nickName !== undefined) { sets.push("nick_name = ?"); params.push(body.nickName); }
    if (body.password !== undefined) { sets.push("password = ?"); params.push(await hashPassword(await decryptPassword(body.password))); }
    if (body.email !== undefined) { sets.push("email = ?"); params.push(body.email); }
    if (body.phonenumber !== undefined) { sets.push("phonenumber = ?"); params.push(body.phonenumber); }
    if (body.sex !== undefined) { sets.push("sex = ?"); params.push(body.sex); }
    if (body.status !== undefined) { sets.push("status = ?"); params.push(body.status); }
    if (body.remark !== undefined) { sets.push("remark = ?"); params.push(body.remark); }
    sets.push("update_by = ?"); params.push(user.username);
    sets.push(`update_time = ${nowSql(db)}`);

    await db.query(`UPDATE sys_user SET ${sets.join(", ")} WHERE user_id = ?`, [...params, id]);

    if (body.roleIds !== undefined) {
      await updateUserRoles(db, id, body.roleIds);
    }

    const [rows] = await db.query(`SELECT * FROM sys_user WHERE user_id = ? LIMIT 1`, [id]);
    return mapRow((rows as SysUserRow[])[0], body.roleIds ?? await getUserRoleIds(db, id));
  });

  // ── 重置密码 ──
  app.patch("/sys-user/:id/resetPwd", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:resetPwd"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const bodyRaw = z.object({ password: z.string().min(1).max(128) }).parse(req.body ?? {});
    // 解密前端传来的密码
    const password = await decryptPassword(bodyRaw.password);
    const body = { password };

    // 密码策略校验
    const policy = await loadPasswordPolicy(db);
    const pwdValidation = validatePassword(body.password, policy);
    if (!pwdValidation.valid) {
      return reply.code(400).send({ error: "password_policy_violation", details: pwdValidation.errors });
    }

    const hash = await hashPassword(body.password);
    await db.query(
      `UPDATE sys_user SET password = ?, pwd_update_date = ${nowSql(db)}, update_by = ?, update_time = ${nowSql(db)} WHERE user_id = ?`,
      [hash, user.username, id],
    );
    return { ok: true };
  });

  // ── 删除（软删除）──
  app.delete("/sys-user/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:remove"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    if (id === user.id) return reply.code(403).send({ error: "cannot_delete_self" });

    if (await isLastAdmin(db, id)) {
      return reply.code(403).send({ error: "last_admin" });
    }

    await db.query(
      `UPDATE sys_user SET del_flag = '2', update_by = ?, update_time = ${nowSql(db)} WHERE user_id = ?`,
      [user.username, id],
    );
    // 清理角色关联
    await db.query(`DELETE FROM sys_user_role WHERE user_id = ?`, [id]);
    return reply.code(204).send();
  });

  // ── 状态切换 ──
  app.patch("/sys-user/:id/changeStatus", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:edit"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const body = z.object({ status: z.enum(["0", "1"]) }).parse(req.body ?? {});

    if (body.status === "1" && await isLastAdmin(db, id)) {
      return reply.code(403).send({ error: "last_admin" });
    }

    await db.query(
      `UPDATE sys_user SET status = ?, update_by = ?, update_time = ${nowSql(db)} WHERE user_id = ?`,
      [body.status, user.username, id],
    );
    return { ok: true };
  });

  // ── 获取角色列表（用于用户表单的角色多选）──
  app.get("/sys-user/roles", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:query"))
      return reply.code(403).send({ error: "forbidden" });

    const [rows] = await db.query(
      `SELECT role_id, role_name, role_key, status FROM sys_role WHERE del_flag = '0' ORDER BY role_sort`,
    );
    return rows;
  });
}
