import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { createSession, hashPassword, verifyPassword } from "../auth.js";
import { loadSessionUser } from "../session-user.js";
import { recordLoginLog } from "../middleware/oper-log.js";
import { nowSql, hasSysUser } from "../sql-utils.js";
import { getConfigInt } from "../config-cache.js";
import { countOnlineUsers } from "../redis.js";
import {
  loadPasswordPolicy,
  validatePassword,
  isDefaultPassword,
  isPasswordExpired,
} from "../password-policy.js";
import { decryptPassword } from "@meeting/shared";

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * 系统同时在线人数限制（登录环节）。
 * 依据 sys_config 的 sys.online.maxUsers 阈值：当前在线用户数达到/超过阈值时
 * 不允许继续登录。system 账号为系统保留账号（拥有全部权限、用于维护该配置），
 * 始终放行，避免系统因自身阈值被锁死。
 * 返回 null 表示放行；否则返回应下发的 HTTP 码与错误码。
 */
async function assertOnlineCapacity(
  db: Db,
  redis: Redis,
  username: string,
): Promise<{ code: number; error: string } | null> {
  if (username === "system") return null;
  const maxUsers = await getConfigInt(db, "sys.online.maxUsers", 20);
  const online = await countOnlineUsers(redis);
  if (online >= maxUsers) {
    return { code: 403, error: "online_limit_reached" };
  }
  return null;
}

/**
 * 检查账户是否已被锁定。
 * 返回 null 表示可以继续登录，否则返回锁定信息。
 */
async function checkAccountLock(
  db: Db,
  redis: Redis,
  username: string,
): Promise<{ locked: true; retryAfter: number } | null> {
  const lockKey = `login_lock:${username}`;
  const locked = await redis.get(lockKey);
  if (locked) {
    const lockDuration = await getConfigInt(db, "sys.login.lockDuration", 60);
    // 内存 Redis 不支持 TTL，返回配置的锁定时长
    return { locked: true, retryAfter: lockDuration };
  }
  return null;
}

/**
 * 记录登录失败，递增计数器，达到阈值时锁定。
 */
async function recordLoginFailure(
  db: Db,
  redis: Redis,
  username: string,
): Promise<void> {
  const maxAttempts = await getConfigInt(db, "sys.login.maxAttempts", 5);
  const lockDuration = await getConfigInt(db, "sys.login.lockDuration", 60);
  const attemptsKey = `login_attempts:${username}`;
  const lockKey = `login_lock:${username}`;

  // 递增失败计数
  const current = await redis.get(attemptsKey);
  const attempts = current ? Number(current) + 1 : 1;
  // 5 分钟窗口
  await redis.set(attemptsKey, String(attempts), "EX", 300);

  if (attempts >= maxAttempts) {
    await redis.set(lockKey, "1", "EX", lockDuration);
    await redis.del(attemptsKey);
  }
}

/**
 * 清除登录失败计数（登录成功时调用）。
 */
async function clearLoginAttempts(redis: Redis, username: string): Promise<void> {
  await redis.del(`login_attempts:${username}`);
  await redis.del(`login_lock:${username}`);
}

export async function authRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  app.post("/auth/login", async (req, reply) => {
    const bodyRaw = LoginBody.parse(req.body);
    // 解密前端传来的密码
    const password = await decryptPassword(bodyRaw.password);
    const body = { ...bodyRaw, password };
    const useSysUser = await hasSysUser(db);

    // ── 检查账户锁定状态 ──
    const lockCheck = await checkAccountLock(db, redis, body.username);
    if (lockCheck?.locked) {
      void recordLoginLog(db, body.username, req.ip, false, "account_locked");
      return reply.code(423).send({
        error: "account_locked",
        retryAfter: lockCheck.retryAfter,
      });
    }

    if (useSysUser) {
      // ── 新表 sys_user ──
      const [rows] = await db.query(
        `SELECT user_id, user_name, nick_name, password, status, del_flag, phonenumber, pwd_update_date
         FROM sys_user WHERE user_name = ? LIMIT 1`,
        [body.username],
      );
      const row = (rows as Record<string, unknown>[])[0];
      if (!row || !(await verifyPassword(body.password, row.password as string))) {
        await recordLoginFailure(db, redis, body.username);
        void recordLoginLog(db, body.username, req.ip, false, "invalid_credentials");
        return reply.code(401).send({ error: "invalid_credentials" });
      }
      if (String(row.status) !== "0" || String(row.del_flag) === "2") {
        return reply.code(403).send({ error: "user_disabled" });
      }

      // ── 密码策略检查 ──
      const policy = await loadPasswordPolicy(db);
      const isDefault = await isDefaultPassword(db, body.password);
      const expired = isPasswordExpired(
        (row.pwd_update_date as string | null) ?? null,
        policy.expireDays,
      );

      const userId = Number(row.user_id);

      // ── 系统同时在线人数限制（登录即拦截，超限不允许登录）──
      const cap = await assertOnlineCapacity(db, redis, body.username);
      if (cap) {
        void recordLoginLog(db, body.username, req.ip, false, "online_limit_reached");
        return reply.code(cap.code).send({ error: cap.error });
      }

      const sessionId = await createSession(redis, userId);

      // 登录成功，清除失败计数
      await clearLoginAttempts(redis, body.username);

      // 更新登录IP和时间
      const ip = req.ip;
      await db.query(
        `UPDATE sys_user SET login_ip = ?, login_date = ${nowSql(db)} WHERE user_id = ?`,
        [ip, userId],
      );

      // 加载用户角色和权限
      const user = await loadSessionUser(db, redis, sessionId);
      void recordLoginLog(db, body.username, req.ip, true);

      // 密码过期：创建临时受限会话，强制用户修改密码
      if (expired) {
        // 标记会话为 force_change_password，中间件将限制除 change-password 外的 API 访问
        // 用普通 string + EX（不用 sadd），兼容内存 Redis 单机模式
        await redis.set(`session_force:${sessionId}`, "1", "EX", 3600); // 1小时过期
      }

      return {
        userId,
        sessionId,
        displayName: row.nick_name as string,
        username: row.user_name as string,
        roles: user?.roles ?? [],
        permissions: user?.permissions ?? [],
        mustChangePassword: isDefault,
        passwordExpired: expired,
        forceChangePassword: expired, // 前端据此跳转修改密码页
      };
    }

    // ── 旧表 users（向后兼容）──
    const [legacyRows] = await db.query(
      `SELECT id, password_hash, display_name, role, status
       FROM users WHERE username = ? LIMIT 1`,
      [body.username],
    );
    const legacyUser = (legacyRows as Record<string, unknown>[])[0];
    if (!legacyUser || !(await verifyPassword(body.password, legacyUser.password_hash as string))) {
      await recordLoginFailure(db, redis, body.username);
      void recordLoginLog(db, body.username, req.ip, false, "invalid_credentials");
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (legacyUser.status !== "active") {
      return reply.code(403).send({ error: "user_disabled" });
    }

    const userId = Number(legacyUser.id);

    // ── 系统同时在线人数限制（登录即拦截，超限不允许登录）──
    const cap = await assertOnlineCapacity(db, redis, body.username);
    if (cap) {
      void recordLoginLog(db, body.username, req.ip, false, "online_limit_reached");
      return reply.code(cap.code).send({ error: cap.error });
    }

    const sessionId = await createSession(redis, userId);

    // 登录成功，清除失败计数
    await clearLoginAttempts(redis, body.username);

    // 尝试加载 RBAC 权限
    const appUser = await loadSessionUser(db, redis, sessionId);
    void recordLoginLog(db, body.username, req.ip, true);
    return {
      userId,
      sessionId,
      displayName: legacyUser.display_name as string,
      username: body.username,
      roles: appUser?.roles ?? (legacyUser.role === "admin" ? ["admin"] : ["common"]),
      permissions: appUser?.permissions ?? [],
      // 向后兼容
      role: legacyUser.role === "admin" ? "admin" : "user",
      mustChangePassword: await isDefaultPassword(db, body.password),
      passwordExpired: false,
    };
  });

  app.get("/auth/me", async (req, reply) => {
    const sessionId = (req.headers["x-session-id"] as string) || "";
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles: user.roles,
      permissions: user.permissions,
      // 向后兼容
      role: user.role,
    };
  });

  const ChangePasswordBody = z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(1).max(128),
  });

  app.post("/auth/change-password", async (req, reply) => {
    const sessionId = (req.headers["x-session-id"] as string) || "";
    const bodyRaw = ChangePasswordBody.parse(req.body);
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    // 解密前端传来的密码
    const currentPassword = await decryptPassword(bodyRaw.currentPassword);
    const newPassword = await decryptPassword(bodyRaw.newPassword);
    const body = { currentPassword, newPassword };

    // ── 密码策略校验 ──
    const policy = await loadPasswordPolicy(db);
    const validation = validatePassword(body.newPassword, policy);
    if (!validation.valid) {
      return reply.code(400).send({ error: "password_policy_violation", details: validation.errors });
    }

    // ── 禁止与旧密码相同 ──
    if (policy.preventReuse && body.currentPassword === body.newPassword) {
      return reply.code(400).send({ error: "password_reuse_not_allowed" });
    }

    const useSysUser = await hasSysUser(db);
    const idCol = useSysUser ? "user_id" : "id";
    const table = useSysUser ? "sys_user" : "users";
    const passCol = useSysUser ? "password" : "password_hash";

    const [rows] = await db.query(
      `SELECT ${passCol} AS hash FROM ${table} WHERE ${idCol} = ? LIMIT 1`,
      [user.id],
    );
    const row = (rows as { hash: string }[])[0];
    if (!row || !(await verifyPassword(body.currentPassword, row.hash))) {
      return reply.code(400).send({ error: "invalid_current_password" });
    }
    const newHash = await hashPassword(body.newPassword);
    await db.query(
      `UPDATE ${table} SET ${passCol} = ?, pwd_update_date = ${nowSql(db)} WHERE ${idCol} = ?`,
      [newHash, user.id],
    );
    // 清除强制修改密码标志
    await redis.del(`session_force:${sessionId}`);
    return { ok: true };
  });

  // 登出：删除服务端会话，立即释放“在线人数”名额（配合 sys.online.maxUsers）
  app.post("/auth/logout", async (req, reply) => {
    const sessionId = (req.headers["x-session-id"] as string) || "";
    if (sessionId) {
      await redis.del(`session:${sessionId}`);
      await redis.del(`session_force:${sessionId}`);
    }
    return { ok: true };
  });
}
