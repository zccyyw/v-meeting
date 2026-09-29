import type { Redis } from "ioredis";
import type { Db } from "./db.js";
import { getSessionUserId } from "./auth.js";
import { tableExists } from "./sql-utils.js";

export type AppUser = {
  id: number;
  username: string;
  displayName: string;
  roles: string[];          // role_key 列表（如 ['admin']）
  permissions: string[];   // 权限标识列表（如 ['system:user:list', ...]）
  status: string;           // '0'=正常 '1'=停用
  deptId: number | null;
  phone: string | null;
  email: string | null;
  // 向后兼容
  role: "admin" | "user";   // 保留字段：admin 角色是否存在
};

// 向后兼容的旧行结构（迁移完成前的 users 表）
type LegacyUserRow = {
  id: number | string;
  username: string;
  display_name: string;
  role: string;
  status: string;
  phone?: string | null;
};

// 新的 sys_user 行结构
type SysUserRow = {
  user_id: number | string;
  dept_id: number | string | null;
  user_name: string;
  nick_name: string;
  status: string;
  phonenumber: string | null;
  email: string | null;
  del_flag: string;
};

type RoleRow = {
  role_key: string;
  status: string;
  del_flag: string;
};

type PermsRow = {
  perms: string;
};

/**
 * 判断表名：如果 sys_user 存在则用新表，否则回退到旧 users 表
 */
async function getUserTableName(db: Db): Promise<"sys_user" | "users"> {
  if (await tableExists(db, "sys_user")) return "sys_user";
  return "users";
}

/**
 * 加载用户的角色和权限
 */
async function loadUserRolesAndPerms(
  db: Db,
  tableName: string,
  userId: number,
): Promise<{ roles: string[]; permissions: string[] }> {
  // 检查 sys_user_role 表是否存在
  const hasRbacTables = await tableExists(db, "sys_user_role");

  if (!hasRbacTables) {
    // RBAC 表不存在，回退到旧 role 字段
    return { roles: [], permissions: [] };
  }

  // 获取用户的角色 key 列表
  const idCol = tableName === "sys_user" ? "user_id" : "id";
  const [roleRows] = await db.query(
    `SELECT r.role_key, r.status, r.del_flag
     FROM sys_user_role ur
     JOIN sys_role r ON ur.role_id = r.role_id
     WHERE ur.user_id = ? AND r.status = '0' AND r.del_flag = '0'`,
    [userId],
  );
  const roles = (roleRows as RoleRow[]).map((r) => r.role_key);

  // 超级管理员拥有所有权限
  if (roles.includes("admin")) {
    const [permsRows] = await db.query(
      `SELECT DISTINCT perms FROM sys_menu WHERE perms IS NOT NULL AND perms != '' AND status = '0'`,
    );
    const permissions = (permsRows as PermsRow[])
      .map((r) => r.perms)
      .filter(Boolean);
    return { roles, permissions };
  }

  // 获取用户通过角色关联的菜单权限标识
  const [permsRows] = await db.query(
    `SELECT DISTINCT m.perms
     FROM sys_user_role ur
     JOIN sys_role_menu rm ON ur.role_id = rm.role_id
     JOIN sys_menu m ON rm.menu_id = m.menu_id
     WHERE ur.user_id = ? AND m.perms IS NOT NULL AND m.perms != ''
       AND m.status = '0'`,
    [userId],
  );
  const permissions = (permsRows as PermsRow[])
    .map((r) => r.perms)
    .filter(Boolean);

  return { roles, permissions };
}

export async function loadSessionUser(
  db: Db,
  redis: Redis,
  sessionId: string | undefined
): Promise<AppUser | null> {
  if (!sessionId) return null;
  const userId = await getSessionUserId(redis, sessionId);
  if (!userId) return null;

  const tableName = await getUserTableName(db);

  if (tableName === "sys_user") {
    // ── 新表：sys_user ──
    const [rows] = await db.query(
      `SELECT user_id, dept_id, user_name, nick_name, status, phonenumber, email, del_flag
       FROM sys_user WHERE user_id = ? LIMIT 1`,
      [userId],
    );
    const row = (rows as SysUserRow[])[0];
    if (!row) return null;
    if (row.status !== "0") return null;
    if (row.del_flag === "2") return null;  // 已删除

    const { roles, permissions } = await loadUserRolesAndPerms(db, tableName, Number(userId));

    return {
      id: Number(row.user_id),
      username: row.user_name,
      displayName: row.nick_name,
      roles,
      permissions,
      status: row.status,
      deptId: row.dept_id ? Number(row.dept_id) : null,
      phone: row.phonenumber ?? null,
      email: row.email ?? null,
      role: roles.includes("admin") ? "admin" : "user",
    };
  }

  // ── 旧表：users（向后兼容）──

  // [P2-10] 退役计划：legacy users 分支计划于后续主版本移除（决策记录见 docs/变更日志.md 2026-09-20）；
  // 移除前提：存量部署完成 sys_user 迁移，且 login/change-password 的 users 回退分支一并清理。
  const [rows] = await db.query(
    `SELECT id, username, display_name, role, status, phone
     FROM users WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = (rows as LegacyUserRow[])[0];
  if (!row) return null;
  if (row.status !== "active") return null;

  // 尝试从 RBAC 表加载权限（如果表已存在）
  const { roles, permissions } = await loadUserRolesAndPerms(db, tableName, Number(userId));
  // 如果 RBAC 表不存在，回退到 role 字段
  const effectiveRoles = roles.length > 0 ? roles : (row.role === "admin" ? ["admin"] : ["common"]);
  const isAdmin = effectiveRoles.includes("admin");

  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    roles: effectiveRoles,
    permissions,
    status: row.status === "active" ? "0" : "1",
    deptId: null,
    phone: row.phone ?? null,
    email: null,
    role: isAdmin ? "admin" : "user",
  };
}

/**
 * 向后兼容：要求 admin 角色
 * 等价于 checkPermission("admin") 或拥有 admin role_key
 */
export async function requireAdmin(
  db: Db,
  redis: Redis,
  sessionId: string | undefined
): Promise<AppUser | null> {
  const user = await loadSessionUser(db, redis, sessionId);
  if (!user) return null;
  // 超级管理员或旧版 admin 角色可通过
  if (user.roles.includes("admin") || user.role === "admin") return user;
  return null;
}

// ── 角色口径统一出口（架构评审 P1-3）────────────────────────────
// 多角色集合的授权判断必须从这里取口径，禁止在路由内联维护数组，
// 避免将来新增角色（如"审批员"）时漏改某处判断。
/** 管理后台角色（超级管理员 + 三员）：会议监控、用户审批等管理接口的授权判断 */
export const MANAGER_ROLES = ["admin", "sys_admin", "auth_admin", "audit_admin"] as const;

/** 审批角色：会议申请审批与用户注册审批的共用口径 */
export const APPROVER_ROLES = ["admin", "auth_admin"] as const;

export function isManagerRole(user: Pick<AppUser, "roles">): boolean {
  return MANAGER_ROLES.some((r) => user.roles.includes(r));
}

export function isApproverRole(user: Pick<AppUser, "roles">): boolean {
  return APPROVER_ROLES.some((r) => user.roles.includes(r));
}

// ── 审批人清单（架构评审 P1-2）──────────────────────────────────
// 站内通知收件人查询：APPROVER_ROLES 口径（admin + auth_admin）。
// 结果进程内缓存 60s：审批人角色授予/回收最多延迟一分钟体现在通知上，可接受。
const approverIdsCache = new Map<object, { ids: number[]; expires: number }>();
const APPROVER_IDS_CACHE_TTL_MS = 60_000;

export async function listApproverUserIds(db: Db): Promise<number[]> {
  const now = Date.now();
  const cached = approverIdsCache.get(db);
  if (cached && cached.expires > now) return cached.ids;

  const ids = new Set<number>();
  if (await tableExists(db, "sys_user")) {
    const [rows] = await db.query(
      `SELECT ur.user_id AS id
       FROM sys_user_role ur
       JOIN sys_role r ON ur.role_id = r.role_id
       JOIN sys_user u ON u.user_id = ur.user_id
       WHERE r.role_key IN (?, ?) AND r.status = '0' AND r.del_flag = '0'
         AND u.status = '0' AND u.del_flag != '2'`,
      [...APPROVER_ROLES],
    );
    for (const row of rows as { id: number | string }[]) ids.add(Number(row.id));
  }
  if (await tableExists(db, "users")) {
    const [rows] = await db.query(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active'`,
    );
    for (const row of rows as { id: number | string }[]) ids.add(Number(row.id));
  }
  const list = [...ids];
  approverIdsCache.set(db, { ids: list, expires: now + APPROVER_IDS_CACHE_TTL_MS });
  return list;
}