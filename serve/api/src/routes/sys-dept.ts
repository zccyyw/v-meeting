import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { nowSql } from "../sql-utils.js";

type DeptRow = {
  dept_id: number | string;
  parent_id: number | string;
  ancestors: string;
  dept_name: string;
  order_num: number;
  leader: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  del_flag: string;
  create_time: string;
};

function mapRow(row: DeptRow) {
  return {
    deptId: Number(row.dept_id),
    parentId: Number(row.parent_id),
    ancestors: row.ancestors,
    deptName: row.dept_name,
    orderNum: row.order_num,
    leader: row.leader ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    status: row.status,
    delFlag: row.del_flag,
    createTime: row.create_time,
  };
}

type DeptNode = ReturnType<typeof mapRow> & { children: DeptNode[] };

/** Build tree from flat rows */
function buildTree(items: ReturnType<typeof mapRow>[], parentId = 0): DeptNode[] {
  return items
    .filter((item) => item.parentId === parentId)
    .map((item) => ({
      ...item,
      children: buildTree(items, item.deptId),
    }))
    .sort((a, b) => a.orderNum - b.orderNum);
}

const CreateDeptBody = z.object({
  parentId: z.number().default(0),
  deptName: z.string().min(1).max(30),
  orderNum: z.number().default(0),
  leader: z.string().max(20).optional().default(""),
  phone: z.string().max(11).optional().default(""),
  email: z.string().max(50).optional().default(""),
  status: z.enum(["0", "1"]).default("0"),
});

const UpdateDeptBody = z.object({
  parentId: z.number().optional(),
  deptName: z.string().min(1).max(30).optional(),
  orderNum: z.number().optional(),
  leader: z.string().max(20).optional(),
  phone: z.string().max(11).optional(),
  email: z.string().max(50).optional(),
  status: z.enum(["0", "1"]).optional(),
});

async function checkDeptExists(db: Db, id: number): Promise<boolean> {
  const [rows] = await db.query(
    `SELECT 1 FROM sys_dept WHERE dept_id = ? AND del_flag = '0' LIMIT 1`,
    [id],
  );
  return (rows as unknown[]).length > 0;
}

async function countDeptChildren(db: Db, id: number): Promise<number> {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS cnt FROM sys_dept WHERE parent_id = ? AND del_flag = '0'`,
    [id],
  );
  return Number((rows as { cnt: number | string }[])[0].cnt);
}

async function getAncestors(db: Db, parentId: number): Promise<string> {
  if (parentId === 0) return "0";
  const [rows] = await db.query(
    `SELECT ancestors, parent_id FROM sys_dept WHERE dept_id = ? LIMIT 1`,
    [parentId],
  );
  const row = (rows as { ancestors: string; parent_id: number }[])[0];
  if (!row) return "0";
  return `${row.ancestors},${parentId}`;
}

export async function deptRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（树结构）──
  app.get("/sys-dept/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:dept:list"))
      return reply.code(403).send({ error: "forbidden" });

    const q = (req.query as { deptName?: string; status?: string }).deptName;
    const status = (req.query as { status?: string }).status;

    let sql = `SELECT * FROM sys_dept WHERE del_flag = '0'`;
    const params: unknown[] = [];
    if (q) {
      sql += ` AND dept_name LIKE ?`;
      params.push(`%${q}%`);
    }
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY parent_id, order_num`;

    const [rows] = await db.query(sql, params);
    const items = (rows as DeptRow[]).map(mapRow);
    // 返回扁平列表 + 树结构
    return { items, tree: buildTree(items) };
  });

  // ── 详情 ──
  app.get("/sys-dept/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:dept:query"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(
      `SELECT * FROM sys_dept WHERE dept_id = ? LIMIT 1`,
      [id],
    );
    const row = (rows as DeptRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    return mapRow(row);
  });

  // ── 新增 ──
  app.post("/sys-dept", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:dept:add"))
      return reply.code(403).send({ error: "forbidden" });

    const body = CreateDeptBody.parse(req.body ?? {});
    const ancestors = await getAncestors(db, body.parentId);

    const [result] = await db.query(
      `INSERT INTO sys_dept (parent_id, ancestors, dept_name, order_num, leader, phone, email, status, del_flag, create_by, create_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '0', ?, ${nowSql(db)})`,
      [body.parentId, ancestors, body.deptName, body.orderNum, body.leader, body.phone, body.email, body.status, user.username],
    );
    const newId = Number((result as { insertId: number }).insertId);
    const [rows] = await db.query(`SELECT * FROM sys_dept WHERE dept_id = ? LIMIT 1`, [newId]);
    return reply.code(201).send(mapRow((rows as DeptRow[])[0]));
  });

  // ── 修改 ──
  app.patch("/sys-dept/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:dept:edit"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    if (!(await checkDeptExists(db, id))) return reply.code(404).send({ error: "not_found" });

    const body = UpdateDeptBody.parse(req.body ?? {});
    if (Object.keys(body).length === 0) return reply.code(400).send({ error: "empty_patch" });

    const sets: string[] = [];
    const params: unknown[] = [];

    if (body.parentId !== undefined) {
      sets.push("parent_id = ?");
      params.push(body.parentId);
      const ancestors = await getAncestors(db, body.parentId);
      sets.push("ancestors = ?");
      params.push(ancestors);
    }
    if (body.deptName !== undefined) { sets.push("dept_name = ?"); params.push(body.deptName); }
    if (body.orderNum !== undefined) { sets.push("order_num = ?"); params.push(body.orderNum); }
    if (body.leader !== undefined) { sets.push("leader = ?"); params.push(body.leader); }
    if (body.phone !== undefined) { sets.push("phone = ?"); params.push(body.phone); }
    if (body.email !== undefined) { sets.push("email = ?"); params.push(body.email); }
    if (body.status !== undefined) { sets.push("status = ?"); params.push(body.status); }

    sets.push("update_by = ?");
    params.push(user.username);
    sets.push(`update_time = ${nowSql(db)}`);

    await db.query(`UPDATE sys_dept SET ${sets.join(", ")} WHERE dept_id = ?`, [...params, id]);
    const [rows] = await db.query(`SELECT * FROM sys_dept WHERE dept_id = ? LIMIT 1`, [id]);
    return mapRow((rows as DeptRow[])[0]);
  });

  // ── 删除（软删除）──
  app.delete("/sys-dept/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!user.roles.includes("admin") && !user.permissions.includes("system:dept:remove"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    if (!(await checkDeptExists(db, id))) return reply.code(404).send({ error: "not_found" });

    // 检查是否有子部门
    const childCount = await countDeptChildren(db, id);
    if (childCount > 0) return reply.code(400).send({ error: "has_children" });

    await db.query(
      `UPDATE sys_dept SET del_flag = '2', update_by = ?, update_time = ${nowSql(db)} WHERE dept_id = ?`,
      [user.username, id],
    );
    return reply.code(204).send();
  });
}
