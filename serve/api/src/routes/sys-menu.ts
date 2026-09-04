import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";

type MenuRow = {
  menu_id: number | string;
  menu_name: string;
  parent_id: number | string;
  order_num: number;
  path: string | null;
  component: string | null;
  query: string | null;
  route_name: string | null;
  is_frame: number;
  is_cache: number;
  menu_type: string;
  visible: string;
  status: string;
  perms: string | null;
  icon: string | null;
  create_time: string;
  remark: string | null;
};

function mapRow(row: MenuRow) {
  return {
    menuId: Number(row.menu_id),
    menuName: row.menu_name,
    parentId: Number(row.parent_id),
    orderNum: row.order_num,
    path: row.path ?? "",
    component: row.component ?? "",
    query: row.query ?? "",
    routeName: row.route_name ?? "",
    isFrame: Boolean(row.is_frame === 0),
    isCache: Boolean(row.is_cache === 0),
    menuType: row.menu_type as "M" | "C" | "F",
    visible: row.visible,
    status: row.status,
    perms: row.perms ?? "",
    icon: row.icon ?? "#",
    createTime: row.create_time,
    remark: row.remark ?? "",
  };
}

type MenuNode = ReturnType<typeof mapRow> & { children: MenuNode[] };

function buildTree(items: ReturnType<typeof mapRow>[], parentId = 0): MenuNode[] {
  return items
    .filter((item) => item.parentId === parentId)
    .map((item) => ({
      ...item,
      children: buildTree(items, item.menuId),
    }))
    .sort((a, b) => a.orderNum - b.orderNum);
}

const CreateMenuBody = z.object({
  parentId: z.number().default(0),
  menuType: z.enum(["M", "C", "F"]).default("C"),
  menuName: z.string().min(1).max(50),
  orderNum: z.number().default(0),
  path: z.string().max(200).optional().default(""),
  component: z.string().max(255).optional().default(""),
  query: z.string().max(255).optional().default(""),
  routeName: z.string().max(50).optional().default(""),
  isFrame: z.boolean().default(false),
  isCache: z.boolean().default(true),
  visible: z.enum(["0", "1"]).default("0"),
  status: z.enum(["0", "1"]).default("0"),
  perms: z.string().max(100).optional().default(""),
  icon: z.string().max(100).optional().default("#"),
  remark: z.string().max(500).optional().default(""),
});

const UpdateMenuBody = z.object({
  parentId: z.number().optional(),
  menuType: z.enum(["M", "C", "F"]).optional(),
  menuName: z.string().min(1).max(50).optional(),
  orderNum: z.number().optional(),
  path: z.string().max(200).optional(),
  component: z.string().max(255).optional(),
  query: z.string().max(255).optional(),
  routeName: z.string().max(50).optional(),
  isFrame: z.boolean().optional(),
  isCache: z.boolean().optional(),
  visible: z.enum(["0", "1"]).optional(),
  status: z.enum(["0", "1"]).optional(),
  perms: z.string().max(100).optional(),
  icon: z.string().max(100).optional(),
  remark: z.string().max(500).optional(),
});

export async function menuRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（树结构）──
  app.get("/sys-menu/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:menu:list"))
      return reply.code(403).send({ error: "forbidden" });

    const q = (req.query as { menuName?: string; status?: string }).menuName;
    const status = (req.query as { status?: string }).status;

    let sql = `SELECT * FROM sys_menu WHERE 1=1`;
    const params: unknown[] = [];
    if (q) { sql += ` AND menu_name LIKE ?`; params.push(`%${q}%`); }
    if (status) { sql += ` AND status = ?`; params.push(status); }
    sql += ` ORDER BY parent_id, order_num`;

    const [rows] = await db.query(sql, params);
    const items = (rows as MenuRow[]).map(mapRow);
    return { items, tree: buildTree(items) };
  });

  // ── 详情 ──
  app.get("/sys-menu/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:menu:query"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(`SELECT * FROM sys_menu WHERE menu_id = ? LIMIT 1`, [id]);
    const row = (rows as MenuRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    return mapRow(row);
  });

  // ── 新增 ──
  app.post("/sys-menu", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:menu:add"))
      return reply.code(403).send({ error: "forbidden" });

    const body = CreateMenuBody.parse(req.body ?? {});
    const [result] = await db.query(
      `INSERT INTO sys_menu (menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowSql(db)}, ?)`,
      [body.menuName, body.parentId, body.orderNum, body.path, body.component, body.query,
       body.routeName, body.isFrame ? 0 : 1, body.isCache ? 0 : 1,
       body.menuType, body.visible, body.status, body.perms, body.icon,
       user.username, body.remark],
    );
    const newId = Number((result as ResultHeader).insertId);
    const [rows] = await db.query(`SELECT * FROM sys_menu WHERE menu_id = ? LIMIT 1`, [newId]);
    return reply.code(201).send(mapRow((rows as MenuRow[])[0]));
  });

  // ── 修改 ──
  app.patch("/sys-menu/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:menu:edit"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const body = UpdateMenuBody.parse(req.body ?? {});
    if (Object.keys(body).length === 0) return reply.code(400).send({ error: "empty_patch" });

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.parentId !== undefined) { sets.push("parent_id = ?"); params.push(body.parentId); }
    if (body.menuType !== undefined) { sets.push("menu_type = ?"); params.push(body.menuType); }
    if (body.menuName !== undefined) { sets.push("menu_name = ?"); params.push(body.menuName); }
    if (body.orderNum !== undefined) { sets.push("order_num = ?"); params.push(body.orderNum); }
    if (body.path !== undefined) { sets.push("path = ?"); params.push(body.path); }
    if (body.component !== undefined) { sets.push("component = ?"); params.push(body.component); }
    if (body.query !== undefined) { sets.push("query = ?"); params.push(body.query); }
    if (body.routeName !== undefined) { sets.push("route_name = ?"); params.push(body.routeName); }
    if (body.isFrame !== undefined) { sets.push("is_frame = ?"); params.push(body.isFrame ? 0 : 1); }
    if (body.isCache !== undefined) { sets.push("is_cache = ?"); params.push(body.isCache ? 0 : 1); }
    if (body.visible !== undefined) { sets.push("visible = ?"); params.push(body.visible); }
    if (body.status !== undefined) { sets.push("status = ?"); params.push(body.status); }
    if (body.perms !== undefined) { sets.push("perms = ?"); params.push(body.perms); }
    if (body.icon !== undefined) { sets.push("icon = ?"); params.push(body.icon); }
    if (body.remark !== undefined) { sets.push("remark = ?"); params.push(body.remark); }
    sets.push("update_by = ?"); params.push(user.username);
    sets.push(`update_time = ${nowSql(db)}`);

    await db.query(`UPDATE sys_menu SET ${sets.join(", ")} WHERE menu_id = ?`, [...params, id]);
    const [rows] = await db.query(`SELECT * FROM sys_menu WHERE menu_id = ? LIMIT 1`, [id]);
    return mapRow((rows as MenuRow[])[0]);
  });

  // ── 删除 ──
  app.delete("/sys-menu/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:menu:remove"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);

    // 检查是否有子菜单
    const [childRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM sys_menu WHERE parent_id = ?`,
      [id],
    );
    if (Number((childRows as { cnt: number | string }[])[0].cnt) > 0) {
      return reply.code(400).send({ error: "has_children" });
    }

    await db.query(`DELETE FROM sys_menu WHERE menu_id = ?`, [id]);
    // 清理角色菜单关联
    await db.query(`DELETE FROM sys_role_menu WHERE menu_id = ?`, [id]);
    return reply.code(204).send();
  });

  // ── 获取当前用户的菜单路由（动态路由用）──
  app.get("/sys-menu/routes", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    let sql: string;
    let params: unknown[];

    if (user.roles.includes("admin")) {
      // 超级管理员获取所有菜单
      sql = `SELECT * FROM sys_menu WHERE status = '0' AND menu_type IN ('M', 'C') ORDER BY parent_id, order_num`;
      params = [];
    } else {
      // 获取用户通过角色关联的菜单
      sql = `SELECT DISTINCT m.* FROM sys_menu m
             JOIN sys_role_menu rm ON m.menu_id = rm.menu_id
             JOIN sys_user_role ur ON rm.role_id = ur.role_id
             WHERE ur.user_id = ? AND m.status = '0' AND m.menu_type IN ('M', 'C')
             ORDER BY m.parent_id, m.order_num`;
      params = [user.id];
    }

    const [rows] = await db.query(sql, params);
    const items = (rows as MenuRow[]).map(mapRow);
    return { tree: buildTree(items) };
  });
}
