import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";

type RoleRow = {
  role_id: number | string;
  role_name: string;
  role_key: string;
  role_sort: number;
  data_scope: string;
  menu_check_strictly: number;
  dept_check_strictly: number;
  status: string;
  del_flag: string;
  remark: string | null;
  create_time: string;
};

function mapRow(row: RoleRow) {
  return {
    roleId: Number(row.role_id),
    roleName: row.role_name,
    roleKey: row.role_key,
    roleSort: row.role_sort,
    dataScope: row.data_scope,
    menuCheckStrictly: Boolean(row.menu_check_strictly),
    deptCheckStrictly: Boolean(row.dept_check_strictly),
    status: row.status,
    delFlag: row.del_flag,
    remark: row.remark ?? "",
    createTime: row.create_time,
  };
}

const CreateRoleBody = z.object({
  roleName: z.string().min(1).max(30),
  roleKey: z.string().min(1).max(100),
  roleSort: z.number().default(0),
  dataScope: z.enum(["1", "2", "3", "4"]).default("1"),
  menuCheckStrictly: z.boolean().default(true),
  deptCheckStrictly: z.boolean().default(true),
  status: z.enum(["0", "1"]).default("0"),
  remark: z.string().max(500).optional().default(""),
  menuIds: z.array(z.number()).optional().default([]),
});

const UpdateRoleBody = z.object({
  roleName: z.string().min(1).max(30).optional(),
  roleKey: z.string().min(1).max(100).optional(),
  roleSort: z.number().optional(),
  dataScope: z.enum(["1", "2", "3", "4"]).optional(),
  menuCheckStrictly: z.boolean().optional(),
  deptCheckStrictly: z.boolean().optional(),
  status: z.enum(["0", "1"]).optional(),
  remark: z.string().max(500).optional(),
  menuIds: z.array(z.number()).optional(),
});

export async function roleRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（分页）──
  app.get("/sys-role/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:role:list"))
      return reply.code(403).send({ error: "forbidden" });

    const query = req.query as { roleName?: string; roleKey?: string; status?: string; page?: string; pageSize?: string };
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);
    const offset = (page - 1) * pageSize;

    let where = `WHERE del_flag = '0'`;
    const params: unknown[] = [];
    if (query.roleName) { where += ` AND role_name LIKE ?`; params.push(`%${query.roleName}%`); }
    if (query.roleKey) { where += ` AND role_key LIKE ?`; params.push(`%${query.roleKey}%`); }
    if (query.status) { where += ` AND status = ?`; params.push(query.status); }

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM sys_role ${where}`, params);
    const total = Number((countRows as { total: number | string }[])[0].total);

    const [rows] = await db.query(
      `SELECT * FROM sys_role ${where} ORDER BY role_sort LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    );
    const items = (rows as RoleRow[]).map(mapRow);
    return { items, total, page, pageSize };
  });

  // ── 详情（含已分配菜单ID列表）──
  app.get("/sys-role/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:role:query"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(`SELECT * FROM sys_role WHERE role_id = ? LIMIT 1`, [id]);
    const row = (rows as RoleRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });

    // 获取已分配的菜单ID
    const [menuRows] = await db.query(
      `SELECT menu_id FROM sys_role_menu WHERE role_id = ?`,
      [id],
    );
    const menuIds = (menuRows as { menu_id: number }[]).map((r) => Number(r.menu_id));
    return { ...mapRow(row), menuIds };
  });

  // ── 新增 ──
  app.post("/sys-role", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:role:add"))
      return reply.code(403).send({ error: "forbidden" });

    const body = CreateRoleBody.parse(req.body ?? {});
    try {
      const [result] = await db.query(
        `INSERT INTO sys_role (role_name, role_key, role_sort, data_scope, menu_check_strictly, dept_check_strictly, status, del_flag, create_by, create_time, remark)
         VALUES (?, ?, ?, ?, ?, ?, ?, '0', ?, ${nowSql(db)}, ?)`,
        [body.roleName, body.roleKey, body.roleSort, body.dataScope,
         body.menuCheckStrictly ? 1 : 0, body.deptCheckStrictly ? 1 : 0,
         body.status, user.username, body.remark],
      );
      const roleId = Number((result as ResultHeader).insertId);

      // 分配菜单
      if (body.menuIds.length > 0) {
        for (const menuId of body.menuIds) {
          await db.query(`INSERT INTO sys_role_menu (role_id, menu_id) VALUES (?, ?)`, [roleId, menuId]);
        }
      }

      const [rows] = await db.query(`SELECT * FROM sys_role WHERE role_id = ? LIMIT 1`, [roleId]);
      return reply.code(201).send(mapRow((rows as RoleRow[])[0]));
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.code === "ER_DUP_ENTRY" || err.code === "23505") {
        return reply.code(409).send({ error: "role_key_taken" });
      }
      throw e;
    }
  });

  // ── 修改 ──
  app.patch("/sys-role/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:role:edit"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const body = UpdateRoleBody.parse(req.body ?? {});
    if (Object.keys(body).length === 0) return reply.code(400).send({ error: "empty_patch" });

    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.roleName !== undefined) { sets.push("role_name = ?"); params.push(body.roleName); }
    if (body.roleKey !== undefined) { sets.push("role_key = ?"); params.push(body.roleKey); }
    if (body.roleSort !== undefined) { sets.push("role_sort = ?"); params.push(body.roleSort); }
    if (body.dataScope !== undefined) { sets.push("data_scope = ?"); params.push(body.dataScope); }
    if (body.menuCheckStrictly !== undefined) { sets.push("menu_check_strictly = ?"); params.push(body.menuCheckStrictly ? 1 : 0); }
    if (body.deptCheckStrictly !== undefined) { sets.push("dept_check_strictly = ?"); params.push(body.deptCheckStrictly ? 1 : 0); }
    if (body.status !== undefined) { sets.push("status = ?"); params.push(body.status); }
    if (body.remark !== undefined) { sets.push("remark = ?"); params.push(body.remark); }
    sets.push("update_by = ?"); params.push(user.username);
    sets.push(`update_time = ${nowSql(db)}`);

    await db.query(`UPDATE sys_role SET ${sets.join(", ")} WHERE role_id = ?`, [...params, id]);

    // 如果传了 menuIds，更新角色菜单关联
    if (body.menuIds !== undefined) {
      await db.query(`DELETE FROM sys_role_menu WHERE role_id = ?`, [id]);
      for (const menuId of body.menuIds) {
        await db.query(`INSERT INTO sys_role_menu (role_id, menu_id) VALUES (?, ?)`, [id, menuId]);
      }
    }

    const [rows] = await db.query(`SELECT * FROM sys_role WHERE role_id = ? LIMIT 1`, [id]);
    return mapRow((rows as RoleRow[])[0]);
  });

  // ── 删除（软删除）──
  app.delete("/sys-role/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:role:remove"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);

    // 超级管理员角色不允许删除
    if (id === 1) return reply.code(403).send({ error: "cannot_delete_admin" });

    // 检查是否有用户关联此角色
    const [userRoleRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM sys_user_role WHERE role_id = ?`,
      [id],
    );
    if (Number((userRoleRows as { cnt: number | string }[])[0].cnt) > 0) {
      return reply.code(400).send({ error: "role_in_use" });
    }

    await db.query(
      `UPDATE sys_role SET del_flag = '2', update_by = ?, update_time = ${nowSql(db)} WHERE role_id = ?`,
      [user.username, id],
    );
    // 清理角色菜单关联
    await db.query(`DELETE FROM sys_role_menu WHERE role_id = ?`, [id]);
    return reply.code(204).send();
  });

  // ── 获取所有菜单（用于角色分配菜单时的选择树）──
  app.get("/sys-role/menu-treeselect", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:role:query"))
      return reply.code(403).send({ error: "forbidden" });

    const [rows] = await db.query(
      `SELECT menu_id AS id, menu_name AS label, parent_id FROM sys_menu
       WHERE status = '0' AND menu_type IN ('M', 'C') ORDER BY parent_id, order_num`,
    );
    const items = rows as { id: number; label: string; parent_id: number }[];

    function buildTree(parentId: number): unknown[] {
      return items
        .filter((i) => i.parent_id === parentId)
        .map((i) => ({
          id: i.id,
          label: i.label,
          children: buildTree(i.id),
        }));
    }
    return buildTree(0);
  });
}
