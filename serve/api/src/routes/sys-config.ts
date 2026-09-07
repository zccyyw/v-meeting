import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";
import { invalidateConfig } from "../config-cache.js";

type ConfigRow = {
  config_id: number | string;
  config_name: string;
  config_key: string;
  config_value: string;
  config_type: string;
  create_by: string | null;
  create_time: string;
  update_by: string | null;
  update_time: string;
  remark: string | null;
};

function mapRow(row: ConfigRow) {
  return {
    configId: Number(row.config_id),
    configName: row.config_name,
    configKey: row.config_key,
    configValue: row.config_value,
    configType: row.config_type,
    createBy: row.create_by ?? "",
    createTime: row.create_time,
    updateBy: row.update_by ?? "",
    updateTime: row.update_time,
    remark: row.remark ?? "",
  };
}

/** 系统保留配置键：仅 system 账号可见/可管理，其余用户一律按“不存在”处理 */
const SYSTEM_ONLY_CONFIG_KEYS = ["sys.online.maxUsers"];

function isSystemAccount(user: { username: string } | null): boolean {
  return !!user && user.username === "system";
}

function isSystemOnlyConfigKey(key: string): boolean {
  return SYSTEM_ONLY_CONFIG_KEYS.includes(key);
}

const CreateBody = z.object({
  configName: z.string().min(1).max(100),
  configKey: z.string().min(1).max(100),
  configValue: z.string().max(500).default(""),
  configType: z.enum(["Y", "N"]).default("N"),
  remark: z.string().max(500).optional().default(""),
});

const UpdateBody = z.object({
  configName: z.string().min(1).max(100).optional(),
  configValue: z.string().max(500).optional(),
  configType: z.enum(["Y", "N"]).optional(),
  remark: z.string().max(500).optional(),
});

/** 按数据库方言返回 LIMIT/OFFSET 语法 */
function limitClause(db: Db, page: number, pageSize: number): string {
  const offset = (page - 1) * pageSize;
  if (db.driver === "mysql") {
    return `LIMIT ${pageSize} OFFSET ${offset}`;
  }
  return `LIMIT ${pageSize} OFFSET ${offset}`;
}

export async function configRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（分页）──
  app.get("/sys-config/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:config:list"))
      return reply.code(403).send({ error: "forbidden" });

    const q = req.query as { configName?: string; configKey?: string; configType?: string; page?: string; pageSize?: string };
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 20);

    let where = `WHERE 1=1`;
    const params: unknown[] = [];
    if (q.configName) { where += ` AND config_name LIKE ?`; params.push(`%${q.configName}%`); }
    if (q.configKey) { where += ` AND config_key LIKE ?`; params.push(`%${q.configKey}%`); }
    if (q.configType) { where += ` AND config_type = ?`; params.push(q.configType); }

    // 保留配置（sys.online.maxUsers）仅 system 账号可见：其余账号从列表隐藏
    if (!isSystemAccount(user)) {
      where += ` AND config_key <> ?`;
      params.push("sys.online.maxUsers");
    }

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM sys_config ${where}`, params);
    const total = Number((countRows as { total: number | string }[])[0].total);

    const [rows] = await db.query(
      `SELECT * FROM sys_config ${where} ORDER BY config_id ${limitClause(db, page, pageSize)}`,
      params,
    );
    const items = (rows as ConfigRow[]).map(mapRow);
    return { items, total, page, pageSize };
  });

  // ── 详情 ──
  app.get("/sys-config/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:config:query"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(`SELECT * FROM sys_config WHERE config_id = ? LIMIT 1`, [id]);
    const row = (rows as ConfigRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    // 保留配置仅 system 账号可读
    if (isSystemOnlyConfigKey(row.config_key) && !isSystemAccount(user)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return mapRow(row);
  });

  // ── 按 key 查询 ──
  app.get("/sys-config/key/:key", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const key = (req.params as { key: string }).key;
    const [rows] = await db.query(`SELECT * FROM sys_config WHERE config_key = ? LIMIT 1`, [key]);
    const row = (rows as ConfigRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    // 保留配置仅 system 账号可读
    if (isSystemOnlyConfigKey(row.config_key) && !isSystemAccount(user)) {
      return reply.code(404).send({ error: "not_found" });
    }
    return mapRow(row);
  });

  // ── 新增 ──
  app.post("/sys-config", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:config:add"))
      return reply.code(403).send({ error: "forbidden" });

    const body = CreateBody.parse(req.body ?? {});
    // 保留配置键仅 system 账号可新增
    if (isSystemOnlyConfigKey(body.configKey) && !isSystemAccount(user)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    try {
      const [result] = await db.query(
        `INSERT INTO sys_config (config_name, config_key, config_value, config_type, create_by, create_time, remark)
         VALUES (?, ?, ?, ?, ?, ${nowSql(db)}, ?)`,
        [body.configName, body.configKey, body.configValue, body.configType, user.username, body.remark],
      );
      const newId = Number((result as ResultHeader).insertId);
      const [rows] = await db.query(`SELECT * FROM sys_config WHERE config_id = ? LIMIT 1`, [newId]);
      return reply.code(201).send(mapRow((rows as ConfigRow[])[0]));
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "ER_DUP_ENTRY" || err.code === "23505") {
        return reply.code(409).send({ error: "config_key_taken" });
      }
      throw e;
    }
  });

  // ── 按 key 修改配置值 ──
  app.put("/sys-config", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:config:edit"))
      return reply.code(403).send({ error: "forbidden" });

    const body = z.object({
      key: z.string().min(1).max(100),
      value: z.string().max(500),
    }).parse(req.body ?? {});

    const [existing] = await db.query(
      `SELECT config_id FROM sys_config WHERE config_key = ? LIMIT 1`,
      [body.key],
    );
    const row = (existing as { config_id: number | string }[])[0];
    if (!row) return reply.code(404).send({ error: "config_not_found" });
    // 保留配置仅 system 账号可修改
    if (isSystemOnlyConfigKey(body.key) && !isSystemAccount(user)) {
      return reply.code(404).send({ error: "config_not_found" });
    }

    await db.query(
      `UPDATE sys_config SET config_value = ?, update_by = ?, update_time = ${nowSql(db)} WHERE config_id = ?`,
      [body.value, user.username, row.config_id],
    );

    // 失效缓存，确保下次读取拿到新值
    invalidateConfig(body.key);

    const [rows] = await db.query(`SELECT * FROM sys_config WHERE config_id = ? LIMIT 1`, [row.config_id]);
    return mapRow((rows as ConfigRow[])[0]);
  });

  // ── 修改 ──
  app.patch("/sys-config/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:config:edit"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const body = UpdateBody.parse(req.body ?? {});
    if (Object.keys(body).length === 0) return reply.code(400).send({ error: "empty_patch" });

    // 保留配置仅 system 账号可修改（非 system 视为不存在）
    const [exRows] = await db.query(
      `SELECT config_key FROM sys_config WHERE config_id = ? LIMIT 1`,
      [id],
    );
    const exRow = (exRows as { config_key?: string }[])[0];
    if (!exRow) return reply.code(404).send({ error: "not_found" });
    if (isSystemOnlyConfigKey(exRow.config_key ?? "") && !isSystemAccount(user)) {
      return reply.code(404).send({ error: "not_found" });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.configName !== undefined) { sets.push("config_name = ?"); params.push(body.configName); }
    if (body.configValue !== undefined) { sets.push("config_value = ?"); params.push(body.configValue); }
    if (body.configType !== undefined) { sets.push("config_type = ?"); params.push(body.configType); }
    if (body.remark !== undefined) { sets.push("remark = ?"); params.push(body.remark); }
    sets.push("update_by = ?"); params.push(user.username);
    sets.push(`update_time = ${nowSql(db)}`);

    await db.query(`UPDATE sys_config SET ${sets.join(", ")} WHERE config_id = ?`, [...params, id]);
    const [rows] = await db.query(`SELECT * FROM sys_config WHERE config_id = ? LIMIT 1`, [id]);
    return mapRow((rows as ConfigRow[])[0]);
  });

  // ── 删除 ──
  app.delete("/sys-config/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:config:remove"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    // 保留配置仅 system 账号可删除（非 system 视为不存在）
    const [exRows] = await db.query(
      `SELECT config_key FROM sys_config WHERE config_id = ? LIMIT 1`,
      [id],
    );
    const exRow = (exRows as { config_key?: string }[])[0];
    if (!exRow) return reply.code(404).send({ error: "not_found" });
    if (isSystemOnlyConfigKey(exRow.config_key ?? "") && !isSystemAccount(user)) {
      return reply.code(404).send({ error: "not_found" });
    }
    await db.query(`DELETE FROM sys_config WHERE config_id = ?`, [id]);
    return reply.code(204).send();
  });
}
