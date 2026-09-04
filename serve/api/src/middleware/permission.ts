import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser, type AppUser } from "../session-user.js";

/**
 * RBAC 权限检查 — 严格对齐若依 permission.ts 设计
 *
 * 用法:
 *   import { checkPermission } from "../middleware/permission.js";
 *   app.get("/users", { preHandler: checkPermission(db, redis, "system:user:list") }, handler);
 *
 * 超级管理员 (role_key = 'admin') 拥有所有权限，无需检查 perms。
 */
export function checkPermission(db: Db, redis: Redis, perm: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);

    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    // 超级管理员拥有所有权限
    if (user.roles.includes("admin")) return;

    // 检查权限标识
    if (!user.permissions.includes(perm)) {
      return reply.code(403).send({ error: "forbidden" });
    }
  };
}

/**
 * 仅验证登录（不需要特定权限）
 */
export function requireLogin(db: Db, redis: Redis) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    // 将用户信息挂载到 request 上供后续使用
    (req as unknown as { appUser: AppUser }).appUser = user;
  };
}

/**
 * 批量注册系统管理路由前缀的权限检查
 * 在 Fastify 路由注册时自动为 /api/sys-* 路径添加鉴权
 */
export function registerPermissionHook(
  app: FastifyInstance,
  db: Db,
  redis: Redis,
) {
  // 为所有 /sys- 开头的路由添加登录验证
  app.addHook("preHandler", async (req, reply) => {
    const url = req.url;
    if (!url.startsWith("/sys-") && !url.startsWith("/api/sys-")) return;

    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) {
      return reply.code(401).send({ error: "unauthorized" });
    }
    (req as unknown as { appUser: AppUser }).appUser = user;
  });
}
