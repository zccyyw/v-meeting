import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";

/**
 * 登录日志路由：固定查询 sys_oper_log 中 log_type='login' 的记录
 * （登录成功/失败 + 登出，business_type：6=登录 7=登出）。
 * 三员分立：授权管理员为主视角；审计管理员可查（除本人）；admin 全部。
 */
type OperLogRow = {
  oper_id: number | string;
  title: string;
  log_type: string;
  business_type: number;
  method: string;
  request_method: string;
  oper_url: string;
  oper_ip: string;
  oper_param: string | null;
  json_result: string | null;
  status: number;
  error_msg: string;
  oper_user_name: string;
  oper_time: string;
  cost_time: number;
};

function mapRow(row: OperLogRow) {
  return {
    operId: Number(row.oper_id),
    title: row.title,
    businessType: row.business_type,
    method: row.method,
    requestMethod: row.request_method,
    operUrl: row.oper_url,
    operIp: row.oper_ip,
    operParam: row.oper_param ?? "",
    jsonResult: row.json_result ?? "",
    status: row.status,
    errorMsg: row.error_msg,
    operUserName: row.oper_user_name,
    operTime: row.oper_time,
    costTime: row.cost_time,
  };
}

function limitClause(db: Db, page: number, pageSize: number): string {
  const offset = (page - 1) * pageSize;
  return `LIMIT ${pageSize} OFFSET ${offset}`;
}

/**
 * 登录日志可见范围：
 * - admin / 授权管理员：全部登录日志
 * - 审计管理员：除本人外
 * - 其他角色（含权限码兜底）：仅本人
 */
function buildScope(user: { roles: string[]; username: string }): string {
  const self = `'${user.username.replace(/'/g, "''")}'`;
  if (user.roles.includes("admin")) return "";
  if (user.roles.includes("auth_admin")) return "";
  if (user.roles.includes("audit_admin")) return ` AND oper_user_name != ${self}`;
  return ` AND oper_user_name = ${self}`;
}

function buildWhere(q: {
  operUserName?: string;
  businessType?: string;
  status?: string;
  operIp?: string;
}, scope: string): { where: string; params: unknown[] } {
  let where = `WHERE log_type = 'login'`;
  where += scope;
  const params: unknown[] = [];
  if (q.operUserName) { where += ` AND oper_user_name LIKE ?`; params.push(`%${q.operUserName}%`); }
  if (q.businessType !== undefined && q.businessType !== "") { where += ` AND business_type = ?`; params.push(Number(q.businessType)); }
  if (q.status !== undefined && q.status !== "") { where += ` AND status = ?`; params.push(Number(q.status)); }
  if (q.operIp) { where += ` AND oper_ip LIKE ?`; params.push(`%${q.operIp}%`); }
  where += ` AND oper_user_name != '${SYSTEM_USER}'`;
  return { where, params };
}

/** 系统内置账号：日志查询默认过滤其记录 */
const SYSTEM_USER = "sysadmin";

function hasReadAccess(user: { roles: string[]; permissions: string[] }, perm: string): boolean {
  return (
    user.roles.includes("admin") ||
    user.roles.includes("auth_admin") ||
    user.roles.includes("audit_admin") ||
    user.permissions.includes(perm)
  );
}

export async function loginLogRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（分页 + 筛选）──
  app.get("/sys-loginlog/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!hasReadAccess(user, "system:loginlog:list"))
      return reply.code(403).send({ error: "forbidden" });

    const q = req.query as {
      operUserName?: string;
      businessType?: string;
      status?: string;
      operIp?: string;
      page?: string;
      pageSize?: string;
    };
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 20);

    const { where, params } = buildWhere(q, buildScope(user));
    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM sys_oper_log ${where}`, params);
    const total = Number((countRows as { total: number | string }[])[0].total);

    const [rows] = await db.query(
      `SELECT * FROM sys_oper_log ${where} ORDER BY oper_id DESC ${limitClause(db, page, pageSize)}`,
      params,
    );
    const items = (rows as OperLogRow[]).map(mapRow);
    return { items, total, page, pageSize };
  });

  // ── 详情 ──
  app.get("/sys-loginlog/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!hasReadAccess(user, "system:loginlog:query"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const scope = buildScope(user);
    const [rows] = await db.query(
      `SELECT * FROM sys_oper_log WHERE oper_id = ? AND log_type = 'login' AND oper_user_name != '${SYSTEM_USER}'${scope} LIMIT 1`,
      [id],
    );
    const row = (rows as OperLogRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    return mapRow(row);
  });

  // ── 导出（CSV）──
  app.get("/sys-loginlog/export", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!hasReadAccess(user, "system:loginlog:export"))
      return reply.code(403).send({ error: "forbidden" });

    const q = req.query as {
      operUserName?: string;
      businessType?: string;
      status?: string;
      operIp?: string;
    };
    const { where, params } = buildWhere(q, buildScope(user));
    const [rows] = await db.query(
      `SELECT * FROM sys_oper_log ${where} ORDER BY oper_id DESC LIMIT 10000`,
      params,
    );

    const headers = ["日志ID", "模块", "业务类型", "请求方法", "操作IP", "操作人", "状态", "错误信息", "操作时间", "耗时(ms)"];
    const lines = [headers.join(",")];
    for (const row of rows as OperLogRow[]) {
      const line = [
        row.oper_id,
        `"${row.title}"`,
        row.business_type,
        `"${row.request_method}"`,
        `"${row.oper_ip}"`,
        `"${row.oper_user_name}"`,
        row.status,
        `"${(row.error_msg ?? "").replace(/"/g, '""')}"`,
        `"${row.oper_time}"`,
        row.cost_time,
      ];
      lines.push(line.join(","));
    }

    const csv = "\uFEFF" + lines.join("\n");
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="loginlog-${Date.now()}.csv"`);
    return reply.send(csv);
  });

  // ── 清空 ──
  app.delete("/sys-loginlog/clean", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("auth_admin") &&
      !user.permissions.includes("system:loginlog:remove")
    )
      return reply.code(403).send({ error: "forbidden" });

    await db.query(`DELETE FROM sys_oper_log WHERE log_type = 'login'`);
    return reply.code(204).send();
  });
}
