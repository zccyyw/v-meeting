import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { hashPassword } from "../auth.js";
import { loadSessionUser } from "../session-user.js";
import { nowSql, hasSysUser } from "../sql-utils.js";
import { loadPasswordPolicy, validatePassword } from "../password-policy.js";
import { decryptPassword } from "@meeting/shared";
import {
  XLSX_MIME,
  PROTECTED_USER_NAMES,
  DEFAULT_IMPORT_PASSWORD,
  DEFAULT_ROLE_KEY,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  buildUsersWorkbook,
  buildTemplateWorkbook,
  formatDateTime,
  parseUserSheet,
  type ImportMode,
} from "../user-xlsx.js";

type SysUserRow = {
  user_id: number | string;
  dept_id: number | string | null;
  user_name: string;
  password: string;
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
  pwd_update_date: string | null;
  create_by: string | null;
  update_by: string | null;
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

// simple-list 专用：群组成员选择器一次拉全量（用户量小），pageSize 上限放宽
const SimpleListQuery = z.object({
  userName: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
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

/** 导出请求：ids（导出勾选）与 q（按列表搜索条件）为空时导出全部未删除用户 */
const ExportBody = z.object({
  ids: z.array(z.coerce.number().int().positive()).max(5000).optional(),
  q: z.string().max(64).optional(),
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

    const q = SimpleListQuery.parse(req.query ?? {});
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

  // ═══════════════ 导入 / 导出 ═══════════════

  // ── 导出：xlsx（全字段，含密码哈希与角色 key）──
  app.post("/sys-user/export", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:export"))
      return reply.code(403).send({ error: "forbidden" });

    const body = ExportBody.parse(req.body ?? {});

    let where = `WHERE u.del_flag = '0' AND u.user_name NOT IN ('system', 'sysadmin')`;
    const params: unknown[] = [];
    if (body.ids && body.ids.length > 0) {
      where += ` AND u.user_id IN (${body.ids.map(() => "?").join(", ")})`;
      params.push(...body.ids);
    }
    if (body.q) {
      where += ` AND (u.user_name LIKE ? OR u.nick_name LIKE ? OR u.phonenumber LIKE ?)`;
      const like = `%${body.q}%`;
      params.push(like, like, like);
    }

    const [rows] = await db.query(
      `SELECT u.*, d.dept_name AS dept_name FROM sys_user u
       LEFT JOIN sys_dept d ON u.dept_id = d.dept_id ${where}
       ORDER BY u.user_id`,
      params,
    );
    const list = rows as (SysUserRow & { dept_name?: string | null })[];

    const { keyById } = await loadRoleDict(db);
    const roleKeys = await loadUserRoleKeys(db, list.map((r) => Number(r.user_id)));

    const data = list.map((r) => {
      const keys = roleKeys.get(Number(r.user_id)) ?? [];
      return {
        user_id: String(r.user_id ?? ""),
        user_name: r.user_name ?? "",
        password: r.password ?? "",
        nick_name: r.nick_name ?? "",
        status: r.status ?? "",
        role_keys: keys.join(","),
        dept_name: r.dept_name ?? "",
        email: r.email ?? "",
        phonenumber: r.phonenumber ?? "",
        sex: r.sex ?? "",
        user_type: r.user_type ?? "",
        avatar: r.avatar ?? "",
        remark: r.remark ?? "",
        del_flag: r.del_flag ?? "",
        login_ip: r.login_ip ?? "",
        login_date: formatDateTime(r.login_date),
        pwd_update_date: formatDateTime(r.pwd_update_date),
        create_by: r.create_by ?? "",
        update_by: r.update_by ?? "",
        create_time: formatDateTime(r.create_time),
        update_time: formatDateTime(r.update_time),
      };
    });

    const buffer = await buildUsersWorkbook(data);
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return reply
      .header("Content-Type", XLSX_MIME)
      .header("Content-Disposition", `attachment; filename="users-${stamp}.xlsx"`)
      .send(buffer);
  });

  // ── 导入模板（simple=最小化 / full=完整迁移）──
  app.get("/sys-user/import-template", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:import"))
      return reply.code(403).send({ error: "forbidden" });

    const rawMode = String((req.query as { mode?: string })?.mode ?? "simple");
    const mode: ImportMode = rawMode === "full" ? "full" : "simple";

    // 部门示例取系统内真实值，便于用户照葫芦画瓢；角色示例固定为普通用户（common），
    // 避免示例数据被直接照抄成管理员账号
    const deptMap = await loadDeptDict(db);
    const deptExample = deptMap.keys().next().value ?? "";

    const buffer = await buildTemplateWorkbook(mode, deptExample);
    return reply
      .header("Content-Type", XLSX_MIME)
      .header(
        "Content-Disposition",
        `attachment; filename="users-import-template-${mode}.xlsx"`,
      )
      .send(buffer);
  });

  // ── 导入：mode=full 完整迁移 / simple 最小化 ──
  app.post("/sys-user/import", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:user:import"))
      return reply.code(403).send({ error: "forbidden" });

    let fileBuffer: Buffer | null = null;
    let mode: ImportMode = "simple";
    let size = 0;
    let tooLarge = false;

    for await (const part of req.parts()) {
      if (part.type === "file") {
        const chunks: Buffer[] = [];
        for await (const chunk of part.file) {
          size += (chunk as Buffer).length;
          if (size > IMPORT_MAX_BYTES) {
            tooLarge = true;
            break;
          }
          chunks.push(chunk as Buffer);
        }
        if (!tooLarge) fileBuffer = Buffer.concat(chunks);
      } else if (part.fieldname === "mode") {
        const v = String(part.value).trim();
        if (v === "full" || v === "simple") mode = v;
      }
    }

    if (tooLarge)
      return reply.code(413).send({ error: "file_too_large", maxBytes: IMPORT_MAX_BYTES });
    if (!fileBuffer) return reply.code(400).send({ error: "no_file" });

    let parsed;
    try {
      parsed = await parseUserSheet(fileBuffer);
    } catch {
      return reply.code(400).send({ error: "invalid_xlsx" });
    }
    if (parsed.headerMap.size === 0) return reply.code(400).send({ error: "invalid_xlsx" });
    if (parsed.rows.length === 0) return reply.code(400).send({ error: "empty_file" });
    if (parsed.rows.length > IMPORT_MAX_ROWS)
      return reply.code(413).send({ error: "too_many_rows", max: IMPORT_MAX_ROWS });

    const { byKey } = await loadRoleDict(db);
    const deptMap = await loadDeptDict(db);
    const defaultRoleId = byKey.get(DEFAULT_ROLE_KEY);

    const stats = {
      total: parsed.rows.length,
      created: 0,
      updated: 0,
      passwordHashed: 0,
      passwordPlain: 0,
    };
    const failed: { row: number; username: string; reason: string }[] = [];
    const warnings: { row: number; message: string }[] = [];
    // 最小化模式的默认密码全批复用同一个哈希：避免上千行逐条 bcrypt（cost 10）耗时数十秒
    let defaultHash: string | null = null;

    for (const { rowNo, cells } of parsed.rows) {
      const account = (cells.user_name ?? "").trim();
      try {
        // ── 字段校验 ──
        if (!account) throw new Error("缺少登录账号");
        if (account.length < 3 || account.length > 30)
          throw new Error("登录账号长度需为 3-30 个字符");
        if (PROTECTED_USER_NAMES.includes(account))
          throw new Error("禁止导入系统保留账号");

        const nickNameRaw = (cells.nick_name ?? "").trim();
        if (!nickNameRaw && mode === "full") throw new Error("缺少用户昵称");
        const nickName = nickNameRaw || account;
        if (nickName.length > 30) throw new Error("用户昵称超长(>30)");

        const email = (cells.email ?? "").trim();
        if (email.length > 50) throw new Error("邮箱超长(>50)");
        const phone = (cells.phonenumber ?? "").trim();
        if (phone.length > 11) throw new Error("手机号超长(>11)");
        const remark = (cells.remark ?? "").trim();
        if (remark.length > 500) throw new Error("备注超长(>500)");

        const sex = normEnum(cells.sex, ["0", "1", "2"], "0");
        const status = normEnum(cells.status, ["0", "1"], "0");
        const userType = ((cells.user_type ?? "").trim() || "00").slice(0, 2);

        // ── 密码：哈希原样写入；明文则重新 hash；最小化留空用默认密码 ──
        let passwordHash: string | null = null;
        const rawPwd = (cells.password ?? "").trim();
        if (rawPwd) {
          if (/^\$2[abxy]\$\d{2}\$/.test(rawPwd)) {
            passwordHash = rawPwd;
            stats.passwordHashed++;
          } else {
            passwordHash = await hashPassword(rawPwd);
            stats.passwordPlain++;
          }
        } else if (mode === "simple") {
          if (!defaultHash) defaultHash = await hashPassword(DEFAULT_IMPORT_PASSWORD);
          passwordHash = defaultHash;
        }

        // ── 角色：按 role_key 匹配；最小化留空默认普通用户 ──
        let roleIds: number[] | undefined;
        const roleKeysRaw = (cells.role_keys ?? "").trim();
        if (roleKeysRaw) {
          const keys = roleKeysRaw.split(/[,，;；\s]+/).filter(Boolean);
          roleIds = [];
          for (const k of keys) {
            const rid = byKey.get(k);
            if (!rid) throw new Error(`角色不存在: ${k}`);
            roleIds.push(rid);
          }
        } else if (mode === "simple" && defaultRoleId) {
          roleIds = [defaultRoleId];
        }

        // ── 部门：按名称匹配；匹配不到则留空并提示 ──
        let deptId: number | null | undefined;
        const deptRaw = (cells.dept_name ?? "").trim();
        if (deptRaw) {
          const hit = deptMap.get(deptRaw);
          if (hit) deptId = hit;
          else warnings.push({ row: rowNo, message: `部门不存在，已留空: ${deptRaw}` });
        }

        // ── upsert ──
        const [existRows] = await db.query(
          `SELECT user_id, del_flag FROM sys_user WHERE user_name = ? LIMIT 1`,
          [account],
        );
        const existing = (existRows as { user_id: number; del_flag: string }[])[0];

        if (!existing) {
          if (!passwordHash)
            throw new Error("缺少密码：完整迁移模式需填写密码或其哈希值");
          const [result] = await db.query(
            `INSERT INTO sys_user (dept_id, user_name, nick_name, user_type, email, phonenumber, sex, avatar, password, status, del_flag, create_by, create_time, remark)
             VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, '0', ?, ${nowSql(db)}, ?)`,
            [
              deptId ?? null,
              account,
              nickName,
              userType,
              email,
              phone,
              sex,
              passwordHash,
              status,
              user.username,
              remark,
            ],
          );
          const newId = Number((result as ResultHeader).insertId);
          if (roleIds && roleIds.length > 0) await updateUserRoles(db, newId, roleIds);
          stats.created++;
          continue;
        }

        const targetId = Number(existing.user_id);
        // 更新：仅覆盖本次提供的字段，其余保持原值
        const sets: string[] = [];
        const params: unknown[] = [];
        // 软删账号（del_flag='2'）一并恢复：系统没有单独的「恢复软删用户」入口，
        // 若在此拒绝，该账号将永远无法再通过导入重建（用户名唯一约束仍在）。
        if (existing.del_flag === "2") {
          warnings.push({ row: rowNo, message: `账号原为软删除状态，已恢复并覆盖: ${account}` });
          sets.push("del_flag = '0'");
        }
        sets.push("nick_name = ?"); params.push(nickName);
        if (deptId !== undefined) { sets.push("dept_id = ?"); params.push(deptId); }
        if (email) { sets.push("email = ?"); params.push(email); }
        if (phone) { sets.push("phonenumber = ?"); params.push(phone); }
        if (cells.sex !== undefined) { sets.push("sex = ?"); params.push(sex); }
        if (cells.status !== undefined) { sets.push("status = ?"); params.push(status); }
        if (cells.user_type) { sets.push("user_type = ?"); params.push(userType); }
        if (remark) { sets.push("remark = ?"); params.push(remark); }
        if (passwordHash) {
          sets.push("password = ?");
          params.push(passwordHash);
          sets.push(`pwd_update_date = ${nowSql(db)}`);
        }
        sets.push("update_by = ?"); params.push(user.username);
        sets.push(`update_time = ${nowSql(db)}`);

        await db.query(`UPDATE sys_user SET ${sets.join(", ")} WHERE user_id = ?`, [
          ...params,
          targetId,
        ]);
        if (roleIds) await updateUserRoles(db, targetId, roleIds);
        stats.updated++;
      } catch (e) {
        failed.push({
          row: rowNo,
          username: account || "(空)",
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      ...stats,
      failed,
      warnings,
      // 最小化模式下新用户统一使用默认密码，需提示用户尽快改密
      defaultPasswordApplied: mode === "simple" ? stats.created : 0,
      defaultPassword: DEFAULT_IMPORT_PASSWORD,
    };
  });
}

/** 枚举值归一化：非法或空值回落默认值 */
function normEnum(raw: string | undefined, allowed: string[], fallback: string): string {
  const v = (raw ?? "").trim();
  return allowed.includes(v) ? v : fallback;
}

/** 角色字典：role_key → role_id、role_id → role_key */
async function loadRoleDict(db: Db) {
  const [rows] = await db.query(
    `SELECT role_id, role_key FROM sys_role WHERE del_flag = '0'`,
  );
  const list = rows as { role_id: number; role_key: string }[];
  const byKey = new Map<string, number>();
  const keyById = new Map<number, string>();
  for (const r of list) {
    byKey.set(r.role_key, Number(r.role_id));
    keyById.set(Number(r.role_id), r.role_key);
  }
  return { byKey, keyById };
}

/** 部门字典：部门名 → dept_id */
async function loadDeptDict(db: Db): Promise<Map<string, number>> {
  const [rows] = await db.query(
    `SELECT dept_id, dept_name FROM sys_dept WHERE del_flag = '0'`,
  );
  return new Map(
    (rows as { dept_id: number; dept_name: string | null }[]).map((r) => [
      String(r.dept_name ?? "").trim(),
      Number(r.dept_id),
    ]),
  );
}

/** 批量取用户的角色 key 列表（一次查询后内存聚合，避免 N+1 与方言差异） */
async function loadUserRoleKeys(db: Db, userIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (userIds.length === 0) return map;
  const [rows] = await db.query(
    `SELECT ur.user_id, r.role_key FROM sys_user_role ur
     JOIN sys_role r ON r.role_id = ur.role_id`,
  );
  const wanted = new Set(userIds);
  for (const r of rows as { user_id: number; role_key: string }[]) {
    const uid = Number(r.user_id);
    if (!wanted.has(uid)) continue;
    const list = map.get(uid);
    if (list) list.push(r.role_key);
    else map.set(uid, [r.role_key]);
  }
  return map;
}
