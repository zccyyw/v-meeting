import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";
import { getConfigInt } from "../config-cache.js";

/**
 * 日志脱敏函数 — 记录前对 password 等敏感字段脱敏
 */
function sanitizeParam(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  try {
    const clone = { ...(body as Record<string, unknown>) };
    const sensitiveFields = ["password", "newPassword", "currentPassword", "joinPassword"];
    for (const key of Object.keys(clone)) {
      if (sensitiveFields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        clone[key] = "***";
      }
    }
    const str = JSON.stringify(clone);
    return str.length > 2000 ? str.slice(0, 2000) + "..." : str;
  } catch {
    return "";
  }
}
export function logOperation(db: Db, title: string, businessType: number = 0) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // 延迟记录到 onResponse 钩子，确保能拿到响应结果
    const startTime = process.hrtime.bigint();
    const sid = req.headers["x-session-id"] as string | undefined;

    // 异步获取用户名（不阻塞请求）
    let userName = "anonymous";
    try {
      if (sid) {
        const user = await loadSessionUser(db, { get: async () => null } as unknown as Redis, sid);
        if (user) userName = user.username;
      }
    } catch { /* ignore */ }

    reply.raw.on("finish", () => {
      const costNs = process.hrtime.bigint() - startTime;
      const costMs = Number(costNs) / 1_000_000;
      const statusCode = reply.statusCode;
      const isSuccess = statusCode >= 200 && statusCode < 400;
      const url = req.url;
      const method = req.method;
      const ip = req.ip;

      // 截取请求参数（避免日志过长） + 脱敏
      const param = sanitizeParam(req.body);

      // 截取响应结果
      const jsonResult = JSON.stringify({ code: statusCode });

      let errorMsg = "";
      if (!isSuccess) {
        errorMsg = `HTTP ${statusCode}`;
      }

      // 异步写入日志（不阻塞响应）
      db.query(
        `INSERT INTO sys_oper_log (title, log_type, business_type, method, request_method, oper_url, oper_ip, oper_param, json_result, status, error_msg, oper_user_name, oper_time, cost_time)
         VALUES (?, 'operation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql(db)}, ?)`,
        [title, businessType, `${method} ${url}`, method, url, ip, param, jsonResult, isSuccess ? 0 : 1, errorMsg, userName, Math.round(costMs)],
      ).catch(() => { /* 忽略日志写入失败 */ });
    });
  };
}

/**
 * 登录日志记录
 */
export async function recordLoginLog(
  db: Db,
  username: string,
  ip: string,
  success: boolean,
  errorMsg: string = "",
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO sys_oper_log (title, log_type, business_type, method, request_method, oper_url, oper_ip, oper_param, json_result, status, error_msg, oper_user_name, oper_time, cost_time)
       VALUES ('登录日志', 'login', 6, 'POST /auth/login', 'POST', '/auth/login', ?, ?, ?, ?, ?, ?, ${nowSql(db)}, 0)`,
      [ip, JSON.stringify({ username }), JSON.stringify({ success }), success ? 0 : 1, errorMsg, username],
    );
  } catch { /* ignore */ }
}

/**
 * 批量注册操作日志钩子
 * 为所有 /sys- 开头的写操作路由自动记录日志
 */
export function registerOperLogHook(app: FastifyInstance, db: Db, redis: Redis) {
  app.addHook("onResponse", async (req, reply) => {
    const url = req.url;
    // 只记录 sys- 路径下的写操作
    if (!url.startsWith("/sys-") && !url.startsWith("/api/sys-")) return;
    if (req.method === "GET") return;

    // 确定模块标题
    let title = "系统管理";
    if (url.includes("/sys-user")) title = "用户管理";
    else if (url.includes("/sys-role")) title = "角色管理";
    else if (url.includes("/sys-menu")) title = "菜单管理";
    else if (url.includes("/sys-dept")) title = "部门管理";
    else if (url.includes("/sys-config")) title = "参数设置";
    else if (url.includes("/sys-notice")) title = "通知公告";

    // 确定业务类型
    let businessType = 0;
    if (req.method === "POST") businessType = 1;
    else if (req.method === "PATCH" || req.method === "PUT") businessType = 2;
    else if (req.method === "DELETE") businessType = 3;

    const sid = req.headers["x-session-id"] as string | undefined;
    let userName = "anonymous";
    try {
      if (sid) {
        const user = await loadSessionUser(db, redis, sid);
        if (user) userName = user.username;
      }
    } catch { /* ignore */ }

    const statusCode = reply.statusCode;
    const isSuccess = statusCode >= 200 && statusCode < 400;
    const ip = req.ip;

    let param = "";
    try {
      if (req.body) {
        param = sanitizeParam(req.body);
      }
    } catch { /* ignore */ }

    await db.query(
      `INSERT INTO sys_oper_log (title, log_type, business_type, method, request_method, oper_url, oper_ip, oper_param, json_result, status, error_msg, oper_user_name, oper_time, cost_time)
       VALUES (?, 'operation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql(db)}, 0)`,
      [title, businessType, `${req.method} ${url}`, req.method, url, ip, param, JSON.stringify({ code: statusCode }), isSuccess ? 0 : 1, isSuccess ? "" : `HTTP ${statusCode}`, userName],
    ).catch(() => { /* 忽略日志写入失败 */ });
  });
}
