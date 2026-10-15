import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";

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
 * 登出日志记录（business_type=7，log_type='login'，与登录日志同属登录日志页）
 */
export async function recordLogoutLog(
  db: Db,
  username: string,
  ip: string,
  success: boolean = true,
  errorMsg: string = "",
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO sys_oper_log (title, log_type, business_type, method, request_method, oper_url, oper_ip, oper_param, json_result, status, error_msg, oper_user_name, oper_time, cost_time)
       VALUES ('登出日志', 'login', 7, 'POST /auth/logout', 'POST', '/auth/logout', ?, ?, ?, ?, ?, ?, ${nowSql(db)}, 0)`,
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
    // CORS 预检请求不携带业务语义，且不允许带自定义头（x-session-id），
    // 记录会产生 oper_user_name=anonymous、businessType=其他 的垃圾数据
    if (req.method === "OPTIONS") return;

    // 确定模块标题（注意：/sys-user-approval 必须在 /sys-user 之前判断）
    let title = "系统管理";
    if (url.includes("/sys-user-approval")) title = "用户审批";
    else if (url.includes("/sys-user")) title = "用户管理";
    else if (url.includes("/sys-role")) title = "角色管理";
    else if (url.includes("/sys-menu")) title = "菜单管理";
    else if (url.includes("/sys-dept")) title = "部门管理";
    else if (url.includes("/sys-config")) title = "参数设置";
    else if (url.includes("/sys-notice")) title = "通知公告";
    else if (url.includes("/sys-operlog")) title = "操作日志";

    // 确定业务类型（枚举对齐若依：1新增 2修改 3删除 4授权 5导出 6导入）
    let businessType = 0;
    if (url.includes("/export")) businessType = 5;
    else if (url.includes("/import")) businessType = 6;
    else if (req.method === "POST") businessType = 1;
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
