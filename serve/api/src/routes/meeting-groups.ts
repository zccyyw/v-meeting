import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db, ResultHeader } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";
import { nowSql, insertIgnorePrefix, conflictSuffix } from "../sql-utils.js";
import { isUniqueViolation } from "../db.js";
import { generateMeetingCode } from "../meeting-code.js";

// ── 群组管理路由 ──

const CreateGroupBody = z.object({
  groupName: z.string().min(1).max(50),
  memberUserIds: z.array(z.number()).optional().default([]),
  memberDeptIds: z.array(z.number()).optional().default([]),
});

const PatchGroupBody = z.object({
  groupName: z.string().min(1).max(50).optional(),
  addUserIds: z.array(z.number()).optional(),
  removeUserIds: z.array(z.number()).optional(),
  addDeptIds: z.array(z.number()).optional(),
  removeDeptIds: z.array(z.number()).optional(),
});

const QuickStartBody = z.object({
  title: z.string().max(200).optional(),
  waitingRoomEnabled: z.boolean().optional(),
});

const PinBody = z.object({ pinned: z.boolean() });

/**
 * 展开群组成员为用户列表（部门展开为部门下所有用户）。
 */
async function expandGroupMembers(
  db: Db,
  groupId: number,
): Promise<{ userId: number; displayName: string }[]> {
  // 查直接选中的用户
  const [userRows] = await db.query(
    `SELECT m.user_id, u.nick_name
     FROM meeting_group_members m
     JOIN sys_user u ON m.user_id = u.user_id
     WHERE m.group_id = ? AND m.user_id IS NOT NULL
       AND u.del_flag = '0' AND u.status = '0'`,
    [groupId],
  );
  // 查选中的部门，展开为部门下所有用户
  const [deptRows] = await db.query(
    `SELECT u.user_id, u.nick_name
     FROM meeting_group_members m
     JOIN sys_user u ON u.dept_id = m.dept_id
     WHERE m.group_id = ? AND m.dept_id IS NOT NULL
       AND u.del_flag = '0' AND u.status = '0'`,
    [groupId],
  );
  // 合并去重
  const map = new Map<number, string>();
  for (const r of [...(userRows as { user_id: number; nick_name: string }[]),
    ...(deptRows as { user_id: number; nick_name: string }[])]) {
    map.set(Number(r.user_id), r.nick_name);
  }
  return [...map].map(([userId, displayName]) => ({ userId, displayName }));
}

export async function meetingGroupRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 创建群组 ──
  app.post("/meeting-groups", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const body = CreateGroupBody.parse(req.body ?? {});

    const [result] = await db.query(
      `INSERT INTO meeting_groups (group_name, owner_id, created_at)
       VALUES (?, ?, ${nowSql(db)})`,
      [body.groupName, user.id],
    );
    const groupId = Number((result as ResultHeader).insertId);

    // 插入用户成员
    for (const userId of body.memberUserIds) {
      await db.query(
        `INSERT INTO meeting_group_members (group_id, user_id) VALUES (?, ?)`,
        [groupId, userId],
      );
    }
    // 插入部门成员
    for (const deptId of body.memberDeptIds) {
      await db.query(
        `INSERT INTO meeting_group_members (group_id, dept_id) VALUES (?, ?)`,
        [groupId, deptId],
      );
    }

    // 返回详情
    const members = await expandGroupMembers(db, groupId);
    return reply.code(201).send({
      groupId,
      groupName: body.groupName,
      members: members.map((m) => ({
        userId: m.userId,
        userName: m.displayName,
        nickName: m.displayName,
        deptId: null,
        deptName: null,
      })),
      deptMembers: [],
    });
  });

  // ── 我的群组列表 ──
  app.get("/meeting-groups", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const q = req.query as { groupName?: string };
    let where = `WHERE g.owner_id = ?`;
    const params: unknown[] = [user.id];
    if (q.groupName) {
      where += ` AND g.group_name LIKE ?`;
      params.push(`%${q.groupName}%`);
    }

    const [rows] = await db.query(
      `SELECT g.group_id, g.group_name, g.created_at, g.pinned,
        (SELECT COUNT(*) FROM meeting_group_members m WHERE m.group_id = g.group_id) AS member_count
       FROM meeting_groups g
       ${where}
       ORDER BY g.pinned DESC, g.created_at DESC`,
      params,
    );

    const items = (rows as { group_id: number; group_name: string; created_at: string; member_count: number | string; pinned?: number | boolean }[]).map((r) => ({
      groupId: Number(r.group_id),
      groupName: r.group_name,
      memberCount: Number(r.member_count),
      createdAt: r.created_at,
      pinned: Boolean(r.pinned),
    }));

    return { items };
  });

  // ── 设置常用（置顶）标记 ──
  app.post("/meeting-groups/:id/pin", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const id = Number((req.params as { id: string }).id);
    const body = PinBody.parse(req.body ?? {});
    const [rows] = await db.query(
      `SELECT owner_id FROM meeting_groups WHERE group_id = ? LIMIT 1`,
      [id],
    );
    const group = (rows as { owner_id: number }[])[0];
    if (!group) return reply.code(404).send({ error: "not_found" });
    if (group.owner_id !== user.id && !user.roles.includes("admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    // SQLite/MySQL 用 0/1，PostgreSQL 用 boolean
    const pinnedVal = db.driver === "postgres" ? body.pinned : body.pinned ? 1 : 0;
    await db.query(
      `UPDATE meeting_groups SET pinned = ? WHERE group_id = ?`,
      [pinnedVal, id],
    );
    return { groupId: id, pinned: body.pinned };
  });

  // ── 群组详情 ──
  app.get("/meeting-groups/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const id = Number((req.params as { id: string }).id);
    const [groupRows] = await db.query(
      `SELECT * FROM meeting_groups WHERE group_id = ? LIMIT 1`,
      [id],
    );
    const group = (groupRows as { group_id: number; group_name: string; owner_id: number; created_at: string }[])[0];
    if (!group) return reply.code(404).send({ error: "not_found" });

    // 检查权限：仅群组所有者或管理员可查看
    if (group.owner_id !== user.id && !user.roles.includes("admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    // 获取直接选中的用户成员
    const [userMembers] = await db.query(
      `SELECT u.user_id, u.user_name, u.nick_name, u.dept_id, d.dept_name
       FROM meeting_group_members m
       JOIN sys_user u ON m.user_id = u.user_id
       LEFT JOIN sys_dept d ON u.dept_id = d.dept_id
       WHERE m.group_id = ? AND m.user_id IS NOT NULL
         AND u.del_flag = '0'`,
      [id],
    );
    const members = (userMembers as { user_id: number; user_name: string; nick_name: string; dept_id: number | null; dept_name: string | null }[]).map((r) => ({
      userId: Number(r.user_id),
      userName: r.user_name,
      nickName: r.nick_name,
      deptId: r.dept_id ? Number(r.dept_id) : null,
      deptName: r.dept_name ?? null,
    }));

    // 获取部门成员
    const [deptMembers] = await db.query(
      `SELECT d.dept_id, d.dept_name,
        (SELECT COUNT(*) FROM sys_user u WHERE u.dept_id = d.dept_id AND u.del_flag = '0' AND u.status = '0') AS user_count
       FROM meeting_group_members m
       JOIN sys_dept d ON m.dept_id = d.dept_id
       WHERE m.group_id = ? AND m.dept_id IS NOT NULL
         AND d.del_flag = '0'`,
      [id],
    );
    const depts = (deptMembers as { dept_id: number; dept_name: string; user_count: number | string }[]).map((r) => ({
      deptId: Number(r.dept_id),
      deptName: r.dept_name,
      userCount: Number(r.user_count),
    }));

    return {
      groupId: Number(group.group_id),
      groupName: group.group_name,
      members,
      deptMembers: depts,
    };
  });

  // ── 修改群组（增量操作）──
  app.patch("/meeting-groups/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const id = Number((req.params as { id: string }).id);
    const body = PatchGroupBody.parse(req.body ?? {});

    // 检查群组存在且属于当前用户
    const [groupRows] = await db.query(
      `SELECT owner_id FROM meeting_groups WHERE group_id = ? LIMIT 1`,
      [id],
    );
    const group = (groupRows as { owner_id: number }[])[0];
    if (!group) return reply.code(404).send({ error: "not_found" });
    if (group.owner_id !== user.id && !user.roles.includes("admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    // 修改群组名称
    if (body.groupName) {
      await db.query(`UPDATE meeting_groups SET group_name = ? WHERE group_id = ?`, [body.groupName, id]);
    }

    // 追加用户
    if (body.addUserIds) {
      for (const userId of body.addUserIds) {
        try {
          await db.query(
            `INSERT INTO meeting_group_members (group_id, user_id) VALUES (?, ?)`,
            [id, userId],
          );
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
        }
      }
    }
    // 移除用户
    if (body.removeUserIds) {
      for (const userId of body.removeUserIds) {
        await db.query(
          `DELETE FROM meeting_group_members WHERE group_id = ? AND user_id = ?`,
          [id, userId],
        );
      }
    }
    // 追加部门
    if (body.addDeptIds) {
      for (const deptId of body.addDeptIds) {
        try {
          await db.query(
            `INSERT INTO meeting_group_members (group_id, dept_id) VALUES (?, ?)`,
            [id, deptId],
          );
        } catch (e) {
          if (!isUniqueViolation(e)) throw e;
        }
      }
    }
    // 移除部门
    if (body.removeDeptIds) {
      for (const deptId of body.removeDeptIds) {
        await db.query(
          `DELETE FROM meeting_group_members WHERE group_id = ? AND dept_id = ?`,
          [id, deptId],
        );
      }
    }

    // 计算成员总数
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM meeting_group_members WHERE group_id = ?`,
      [id],
    );
    const memberCount = Number((countRows as { cnt: number | string }[])[0].cnt);

    return { groupId: id, groupName: body.groupName ?? "", memberCount };
  });

  // ── 删除群组 ──
  app.delete("/meeting-groups/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const id = Number((req.params as { id: string }).id);
    const [groupRows] = await db.query(
      `SELECT owner_id FROM meeting_groups WHERE group_id = ? LIMIT 1`,
      [id],
    );
    const group = (groupRows as { owner_id: number }[])[0];
    if (!group) return reply.code(404).send({ error: "not_found" });
    if (group.owner_id !== user.id && !user.roles.includes("admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    await db.query(`DELETE FROM meeting_group_members WHERE group_id = ?`, [id]);
    await db.query(`DELETE FROM meeting_groups WHERE group_id = ?`, [id]);
    return reply.code(204).send();
  });

  // ── 一键群组开会 ──
  app.post("/meeting-groups/:id/quick-start", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const id = Number((req.params as { id: string }).id);
    const body = QuickStartBody.parse(req.body ?? {});

    // 检查群组存在且属于当前用户
    const [groupRows] = await db.query(
      `SELECT group_name, owner_id FROM meeting_groups WHERE group_id = ? LIMIT 1`,
      [id],
    );
    const group = (groupRows as { group_name: string; owner_id: number }[])[0];
    if (!group) return reply.code(404).send({ error: "not_found" });
    if (group.owner_id !== user.id && !user.roles.includes("admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    // 展开群组成员
    const members = await expandGroupMembers(db, id);

    // 创建会议
    const title = body.title || group.group_name;
    let code = generateMeetingCode();
    let meetingId: number | null = null;

    for (let i = 0; i < 5; i++) {
      try {
        const [result] = await db.query(
          `INSERT INTO meetings
           (code, title, host_user_id, status, waiting_room_enabled, join_password_hash, scheduled_at)
           VALUES (?, ?, ?, 'live', ?, NULL, NULL)`,
          [code, title, user.id, body.waitingRoomEnabled ? 1 : 0],
        );
        meetingId = Number((result as ResultHeader).insertId);
        break;
      } catch (e: unknown) {
        if (isUniqueViolation(e)) {
          code = generateMeetingCode();
          continue;
        }
        throw e;
      }
    }

    if (meetingId == null) {
      return reply.code(503).send({ error: "meeting_create_failed" });
    }

    // 批量插入邀请名单（忽略重复，兼容三方言）
    const invitePrefix = insertIgnorePrefix(db);
    const inviteSuffix = conflictSuffix(db, "meeting_id, user_id");
    for (const m of members) {
      await db.query(
        `${invitePrefix} INTO meeting_invitations (meeting_id, user_id, display_name, status, invited_at)
         VALUES (?, ?, ?, 'pending', ${nowSql(db)}) ${inviteSuffix}`,
        [meetingId, m.userId, m.displayName],
      );
    }

    return {
      meetingId,
      code,
      title,
      invitedCount: members.length,
    };
  });

}
