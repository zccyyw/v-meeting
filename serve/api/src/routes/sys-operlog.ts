import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { getConfigInt } from "../config-cache.js";
import { nowSql } from "../sql-utils.js";

type OperLogRow = {
  oper_id: number | string;
  title: string;
  log_type: string;
  business_type: number;
  method: string;
  request_method: string;
  oper_url: string;
  oper_ip: string;
  oper_location: string;
  oper_param: string | null;
  json_result: string | null;
  status: number;
  error_msg: string;
  oper_user_name: string;
  oper_time: string;
  cost_time: number;
  oper_object?: string | null;
  classification?: string | null;
};

function mapRow(row: OperLogRow) {
  return {
    operId: Number(row.oper_id),
    title: row.title,
    logType: row.log_type,
    businessType: row.business_type,
    method: row.method,
    requestMethod: row.request_method,
    operUrl: row.oper_url,
    operIp: row.oper_ip,
    operLocation: row.oper_location,
    operParam: row.oper_param ?? "",
    jsonResult: row.json_result ?? "",
    status: row.status,
    errorMsg: row.error_msg,
    operUserName: row.oper_user_name,
    operTime: row.oper_time,
    costTime: row.cost_time,
    operObject: row.oper_object ?? "",
    classification: row.classification ?? "公开",
  };
}

function limitClause(db: Db, page: number, pageSize: number): string {
  const offset = (page - 1) * pageSize;
  return `LIMIT ${pageSize} OFFSET ${offset}`;
}

/**
 * 根据用户角色构建日志查询的 WHERE 条件（三员分立）。
 * - 审计管理员：除自己外所有日志
 * - 授权管理员：仅登录日志
 * - 系统管理员：仅操作日志
 * - 超级管理员：全部日志
 */
function buildLogScope(user: { roles: string[]; username: string }): string {
  if (user.roles.includes("admin")) return ""; // 全部
  if (user.roles.includes("audit_admin")) {
    return ` AND oper_user_name != '${user.username.replace(/'/g, "''")}'`;
  }
  if (user.roles.includes("auth_admin")) {
    return ` AND log_type = 'login'`;
  }
  if (user.roles.includes("sys_admin")) {
    return ` AND log_type = 'operation'`;
  }
  return ` AND 1=0`; // 无权限查看
}

export async function operLogRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（分页 + 筛选 + 三员分级）──
  app.get("/sys-operlog/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("audit_admin") &&
      !user.roles.includes("auth_admin") &&
      !user.roles.includes("sys_admin") &&
      !user.permissions.includes("system:operlog:list")
    )
      return reply.code(403).send({ error: "forbidden" });

    const q = req.query as {
      title?: string;
      logType?: string;
      operUserName?: string;
      status?: string;
      operObject?: string;
      page?: string;
      pageSize?: string;
    };
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 20);

    let where = `WHERE 1=1${buildLogScope(user)}`;
    const params: unknown[] = [];
    if (q.title) { where += ` AND title LIKE ?`; params.push(`%${q.title}%`); }
    if (q.logType) { where += ` AND log_type = ?`; params.push(q.logType); }
    if (q.operUserName) { where += ` AND oper_user_name LIKE ?`; params.push(`%${q.operUserName}%`); }
    if (q.status !== undefined && q.status !== "") { where += ` AND status = ?`; params.push(Number(q.status)); }
    if (q.operObject) { where += ` AND oper_object LIKE ?`; params.push(`%${q.operObject}%`); }

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
  app.get("/sys-operlog/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("audit_admin") &&
      !user.roles.includes("auth_admin") &&
      !user.roles.includes("sys_admin") &&
      !user.permissions.includes("system:operlog:query")
    )
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(`SELECT * FROM sys_oper_log WHERE oper_id = ? LIMIT 1`, [id]);
    const row = (rows as OperLogRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });

    // 三员分立检查：非超级管理员不能看自己范围的日志
    const scope = buildLogScope(user);
    if (scope) {
      const [scopeCheck] = await db.query(
        `SELECT 1 AS ok FROM sys_oper_log WHERE oper_id = ?${scope} LIMIT 1`,
        [id],
      );
      if (!scopeCheck || (scopeCheck as unknown[]).length === 0) {
        return reply.code(403).send({ error: "forbidden" });
      }
    }

    return mapRow(row);
  });

  // ── 导出（CSV 格式）──
  app.get("/sys-operlog/export", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("audit_admin") &&
      !user.permissions.includes("system:operlog:export")
    )
      return reply.code(403).send({ error: "forbidden" });

    const q = req.query as {
      title?: string;
      logType?: string;
      operUserName?: string;
      status?: string;
    };

    let where = `WHERE 1=1${buildLogScope(user)}`;
    const params: unknown[] = [];
    if (q.title) { where += ` AND title LIKE ?`; params.push(`%${q.title}%`); }
    if (q.logType) { where += ` AND log_type = ?`; params.push(q.logType); }
    if (q.operUserName) { where += ` AND oper_user_name LIKE ?`; params.push(`%${q.operUserName}%`); }
    if (q.status !== undefined && q.status !== "") { where += ` AND status = ?`; params.push(Number(q.status)); }

    const [rows] = await db.query(
      `SELECT * FROM sys_oper_log ${where} ORDER BY oper_id DESC LIMIT 10000`,
      params,
    );
    const items = rows as OperLogRow[];

    // 生成 CSV
    const headers = ["日志ID", "模块", "日志类型", "业务类型", "请求方法", "操作URL", "操作IP", "操作人", "状态", "错误信息", "操作时间", "耗时(ms)", "操作对象", "密级"];
    const lines = [headers.join(",")];
    for (const row of items) {
      const line = [
        row.oper_id,
        `"${row.title}"`,
        `"${row.log_type}"`,
        row.business_type,
        `"${row.request_method}"`,
        `"${row.oper_url}"`,
        `"${row.oper_ip}"`,
        `"${row.oper_user_name}"`,
        row.status,
        `"${(row.error_msg ?? "").replace(/"/g, '""')}"`,
        `"${row.oper_time}"`,
        row.cost_time,
        `"${(row.oper_object ?? "").replace(/"/g, '""')}"`,
        `"${row.classification ?? "公开"}"`,
      ];
      lines.push(line.join(","));
    }

    const csv = "\uFEFF" + lines.join("\n");
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="operlog-${Date.now()}.csv"`);
    return reply.send(csv);
  });

  // ── 删除 ──
  app.delete("/sys-operlog/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("audit_admin") &&
      !user.permissions.includes("system:operlog:remove")
    )
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    await db.query(`DELETE FROM sys_oper_log WHERE oper_id = ?`, [id]);
    return reply.code(204).send();
  });

  // ── 清空 ──
  app.delete("/sys-operlog/clean", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("audit_admin") &&
      !user.permissions.includes("system:operlog:remove")
    )
      return reply.code(403).send({ error: "forbidden" });

    await db.query(`DELETE FROM sys_oper_log`);
    return reply.code(204).send();
  });

  // ── 清理过期日志（定时任务手动触发端点）──
  app.post("/sys-operlog/cleanup-expired", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.roles.includes("audit_admin"))
      return reply.code(403).send({ error: "forbidden" });

    const retentionDays = await getConfigInt(db, "sys.log.retentionDays", 365);
    if (retentionDays <= 0) return { deleted: 0, retentionDays };

    let deleteSql: string;
    if (db.driver === "sqlite") {
      deleteSql = `DELETE FROM sys_oper_log WHERE oper_time < datetime('now', ?)`;
    } else if (db.driver === "postgres") {
      deleteSql = `DELETE FROM sys_oper_log WHERE oper_time < NOW() - make_interval(days => ?)`;
    } else {
      deleteSql = `DELETE FROM sys_oper_log WHERE oper_time < DATE_SUB(NOW(), INTERVAL ? DAY)`;
    }
    const [result] = await db.query(deleteSql, [retentionDays]);
    const deleted = (result as { affectedRows?: number }).affectedRows ?? 0;
    return { deleted, retentionDays };
  });
}

/**
 * 定时清理过期日志 — 在 index.ts 中通过 setInterval 调用。
 */
export async function cleanupExpiredLogs(db: Db): Promise<number> {
  const retentionDays = await getConfigInt(db, "sys.log.retentionDays", 365);
  if (retentionDays <= 0) return 0;

  let deleteSql: string;
  if (db.driver === "sqlite") {
    deleteSql = `DELETE FROM sys_oper_log WHERE oper_time < datetime('now', ?)`;
  } else if (db.driver === "postgres") {
    deleteSql = `DELETE FROM sys_oper_log WHERE oper_time < NOW() - make_interval(days => ?)`;
  } else {
    deleteSql = `DELETE FROM sys_oper_log WHERE oper_time < DATE_SUB(NOW(), INTERVAL ? DAY)`;
  }
  const [result] = await db.query(deleteSql, [retentionDays]);
  return (result as { affectedRows?: number }).affectedRows ?? 0;
}
