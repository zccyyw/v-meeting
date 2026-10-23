import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CreateMeetingSchema, JoinTokenBodySchema } from "@meeting/shared";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { isUniqueViolation, type ResultHeader } from "../db.js";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { hashPassword, verifyPassword } from "../auth.js";
import { generateMeetingCode } from "../meeting-code.js";
import { isManagerRole, loadSessionUser, type AppUser } from "../session-user.js";
import { nowSql, insertIgnorePrefix, conflictSuffix } from "../sql-utils.js";
import { subscribeUser, notifyUser } from "../notify.js";

const zDisplayName = z.string().min(1).max(64);


/**
 * 会议访问授权：仅主持人或管理后台角色可进行会议级管理操作（查看/邀请名单等）。
 * 内部校验会议是否存在。返回 true 放行；false 表示已发送 403/404 响应。
 */
async function assertMeetingManageAccess(
  db: Db,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  user: AppUser,
  meetingId: number,
): Promise<boolean> {
  if (isManagerRole(user)) {
    // 管理后台角色仍需确认会议存在
    const [check] = await db.query(
      `SELECT id FROM meetings WHERE id = ? LIMIT 1`,
      [meetingId],
    );
    if (!(check as any[])[0]) {
      reply.code(404).send({ error: "not_found" });
      return false;
    }
    return true;
  }
  const [rows] = await db.query(
    `SELECT host_user_id FROM meetings WHERE id = ? LIMIT 1`,
    [meetingId],
  );
  const m = (rows as any[])[0];
  if (!m) {
    reply.code(404).send({ error: "not_found" });
    return false;
  }
  if (String(m.host_user_id) === String(user.id)) return true;
  reply.code(403).send({ error: "forbidden" });
  return false;
}

async function assertJoinPassword(
  m: { host_user_id: unknown; join_password_hash: string | null },
  userId: number | null,
  password: string | undefined,
  reply: { code: (n: number) => { send: (b: unknown) => unknown } },
): Promise<boolean> {
  const hash = m.join_password_hash;
  if (!hash) return true;
  const isHost = userId != null && String(m.host_user_id) === String(userId);
  if (isHost) return true;
  if (!password) {
    reply.code(403).send({ error: "password_required" });
    return false;
  }
  const ok = await verifyPassword(password, hash);
  if (!ok) {
    reply.code(403).send({ error: "invalid_join_password" });
    return false;
  }
  return true;
}

async function markLiveIfScheduled(db: Db, meetingId: number, status: string) {
  if (status !== "scheduled") return;
  await db.query(`UPDATE meetings SET status = 'live' WHERE id = ? AND status = 'scheduled'`, [
    meetingId,
  ]);
}

function mapMeetingRow(m: any) {
  return {
    id: Number(m.id),
    code: m.code,
    title: m.title,
    hostUserId: m.host_user_id == null ? null : Number(m.host_user_id),
    status: m.status,
    waitingRoomEnabled: !!m.waiting_room_enabled,
    scheduledAt: m.scheduled_at ? new Date(m.scheduled_at).toISOString() : null,
    createdAt: new Date(m.created_at).toISOString(),
    passwordRequired: Boolean(m.join_password_hash),
  };
}

export async function meetingRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  app.post("/meetings", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    let body;
    try {
      body = CreateMeetingSchema.parse(req.body ?? {});
    } catch (err) {
      if (err instanceof z.ZodError) {
        const msg = err.issues[0]?.message;
        if (msg === "scheduled_time_in_past" || msg === "join_password_only_for_scheduled") {
          return reply.code(400).send({ error: msg });
        }
      }
      throw err;
    }

    let code = generateMeetingCode();
    const status = body.scheduledAt ? "scheduled" : "live";
    let meetingId: number | null = null;

    let joinPasswordHash: string | null = null;
    if (body.scheduledAt && body.joinPassword) {
      joinPasswordHash = await hashPassword(body.joinPassword);
    }

    for (let i = 0; i < 5; i++) {
      try {
        const [result] = await db.query(
          `INSERT INTO meetings
           (code, title, host_user_id, status, waiting_room_enabled, allow_share, join_password_hash, scheduled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            code,
            body.title,
            user.id,
            status,
            body.waitingRoomEnabled ? 1 : 0,
            body.allowShare ? 1 : 0,
            joinPasswordHash,
            body.scheduledAt ? new Date(body.scheduledAt) : null,
          ],
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

    // Instant meetings get a host token for immediate entry.
    // Scheduled meetings skip token issuance; host joins later via join-token.
    let hostJoinToken: string | null = null;
    if (!body.scheduledAt) {
      const token = randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 24 * 3600 * 1000);
      await db.query(
        `INSERT INTO meeting_join_tokens (token, meeting_id, user_id, role, expires_at)
         VALUES (?, ?, ?, 'host', ?)`,
        [token, meetingId, user.id, expires],
      );
      hostJoinToken = token;
    }

    return {
      id: meetingId,
      code,
      title: body.title,
      status,
      waitingRoomEnabled: body.waitingRoomEnabled,
      scheduledAt: body.scheduledAt ?? null,
      passwordEnabled: Boolean(joinPasswordHash),
      hostJoinToken,
    };
  });

  app.get("/meetings", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const [rows] = await db.query(
      `SELECT m.id, m.code, m.title, m.host_user_id, m.status, m.waiting_room_enabled,
              m.scheduled_at, m.created_at, m.join_password_hash,
              ma.priority
       FROM meetings m
       LEFT JOIN meeting_applications ma ON ma.meeting_id = m.id
       WHERE m.host_user_id = ?
         AND m.status IN ('scheduled', 'live')
       ORDER BY
         CASE m.status WHEN 'live' THEN 0 ELSE 1 END,
         CASE WHEN ma.priority IS NULL THEN 1 ELSE 0 END,
         CASE ma.priority WHEN '高' THEN 1 WHEN '中' THEN 2 WHEN '低' THEN 3 ELSE 4 END,
         CASE WHEN m.scheduled_at IS NULL THEN 1 ELSE 0 END,
         m.scheduled_at ASC,
         m.created_at DESC`,
      [user.id],
    );

    const items = (rows as any[]).map((m) => {
      const mapped = mapMeetingRow(m);
      // Host viewing own list never needs password.
      return { ...mapped, passwordRequired: false, priority: m.priority ?? null };
    });
    return { items };
  });

  // ── 我的待加入会议（被邀请人视角，用于站内通知） ──
  // 群组“一键开会”会为全体成员写入 pending 邀请；被邀请人登录后凭此接口
  // 拉取“待我加入”的会议列表，无需知道会议号。仅返回未结束的会议。
  app.get("/meetings/my-invitations", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    try {
      const [rows] = await db.query(
        `SELECT i.id AS invitation_id, i.status AS invitation_status, i.invited_at,
                m.id AS meeting_id, m.code, m.title, m.status AS meeting_status,
                m.scheduled_at, u.nick_name AS host_name
         FROM meeting_invitations i
         JOIN meetings m ON m.id = i.meeting_id
         LEFT JOIN sys_user u ON u.user_id = m.host_user_id
         WHERE i.user_id = ?
           AND i.status IN ('pending', 'accepted')
           AND m.status IN ('scheduled', 'live')
         ORDER BY
           CASE m.status WHEN 'live' THEN 0 ELSE 1 END,
           i.invited_at DESC`,
        [user.id],
      );
      const items = (rows as any[]).map((r) => ({
        invitationId: Number(r.invitation_id),
        invitationStatus: r.invitation_status,
        meetingId: Number(r.meeting_id),
        code: r.code,
        title: r.title,
        meetingStatus: r.meeting_status,
        scheduledAt: r.scheduled_at
          ? new Date(r.scheduled_at).toISOString()
          : null,
        hostName: r.host_name ?? null,
        invitedAt: r.invited_at ? new Date(r.invited_at).toISOString() : null,
      }));
      return { items };
    } catch {
      // 表可能不存在（未迁移）
      return { items: [] };
    }
  });

  // ── 历史会议（我主持的 + 我参加过的，已结束）──
  const historyVisible = (uid: number) =>
    `m.status = 'ended' AND (m.host_user_id = ${uid} OR EXISTS(
      SELECT 1 FROM meeting_invitations i
      WHERE i.meeting_id = m.id AND i.user_id = ${uid} AND i.status = 'attended'
    ))`;

  app.get("/meetings/my-history", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const uid = Number(user.id);
    const q = req.query as { page?: string; pageSize?: string };
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(Math.max(1, Number(q.pageSize ?? 20)), 50);
    const vis = historyVisible(uid);

    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM meetings m WHERE ${vis}`);
    const total = Number((countRows as { total: number | string }[])[0].total);

    const offset = (page - 1) * pageSize;
    const [rows] = await db.query(
      `SELECT m.id, m.code, m.title, m.host_user_id, m.scheduled_at, m.created_at, m.ended_at,
              u.user_name AS host_name,
              (SELECT COUNT(*) FROM meeting_invitations ii WHERE ii.meeting_id = m.id AND ii.status = 'attended') + CASE WHEN m.host_user_id IS NULL THEN 0 WHEN EXISTS (SELECT 1 FROM meeting_invitations ii2 WHERE ii2.meeting_id = m.id AND ii2.status = 'attended' AND ii2.user_id = m.host_user_id) THEN 0 ELSE 1 END AS participants,
              (SELECT MIN(ii.joined_at) FROM meeting_invitations ii WHERE ii.meeting_id = m.id AND ii.status = 'attended') AS first_joined
       FROM meetings m
       LEFT JOIN sys_user u ON u.user_id = m.host_user_id
       WHERE ${vis}
       ORDER BY m.ended_at DESC
       LIMIT ${pageSize} OFFSET ${offset}`,
    );
    const norm = (v: unknown): string | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
      return String(v);
    };
    const items = (rows as Record<string, unknown>[]).map((r) => {
      const startTime = norm(r.first_joined) ?? norm(r.created_at) ?? "";
      const endTime = norm(r.ended_at) ?? "";
      const startMs = startTime ? new Date(startTime.replace(" ", "T")).getTime() : NaN;
      const endMs = endTime ? new Date(endTime.replace(" ", "T")).getTime() : NaN;
      return {
        meetingId: Number(r.id),
        code: String(r.code ?? ""),
        title: String(r.title ?? ""),
        hostName: String(r.host_name ?? ""),
        meetingType: r.scheduled_at ? "2" : "1",
        startTime,
        endTime,
        durationSec:
          Number.isFinite(startMs) && Number.isFinite(endMs)
            ? Math.max(0, Math.floor((endMs - startMs) / 1000))
            : 0,
        participantCount: Number(r.participants) || 0,
        myRole: Number(r.host_user_id) === uid ? "host" : "participant",
      };
    });
    return { items, total, page, pageSize };
  });

  app.get("/meetings/my-history/:id", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const uid = Number(user.id);
    const id = Number((req.params as { id: string }).id);
    const vis = historyVisible(uid);

    const [rows] = await db.query(
      `SELECT m.id, m.code, m.title, m.host_user_id, m.scheduled_at, m.created_at, m.ended_at,
              u.user_name AS host_name
       FROM meetings m
       LEFT JOIN sys_user u ON u.user_id = m.host_user_id
       WHERE m.id = ? AND ${vis}
       LIMIT 1`,
      [id],
    );
    const m = (rows as Record<string, unknown>[])[0];
    if (!m) return reply.code(404).send({ error: "not_found" });

    // 实际参会明细：优先取 meeting_attendance（覆盖凭会议号加入/访客/快速会议
    // 主持人——这些路径不入邀请表）；无记录（历史旧会议/旧版本）回退邀请表
    const [attRows] = await db.query(
      `SELECT display_name, joined_at FROM meeting_attendance
       WHERE meeting_id = ? ORDER BY joined_at ASC`,
      [id],
    );
    const norm = (v: unknown): string | null => {
      if (v == null) return null;
      if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
      return String(v);
    };
    let attendees = (attRows as { display_name: string; joined_at: unknown }[]).map((r) => ({
      name: r.display_name ?? "",
      deptName: "",
      joinedAt: norm(r.joined_at) ?? "",
    }));
    if (attendees.length === 0) {
      const [invRows] = await db.query(
        `SELECT ii.display_name, ii.joined_at, d.dept_name
         FROM meeting_invitations ii
         LEFT JOIN sys_dept d ON d.dept_id = ii.dept_id
         WHERE ii.meeting_id = ? AND ii.status = 'attended'
         ORDER BY ii.joined_at ASC`,
        [id],
      );
      attendees = (invRows as { display_name: string | null; dept_name: string | null; joined_at: unknown }[]).map((r) => ({
        name: r.display_name ?? "",
        deptName: r.dept_name ?? "",
        joinedAt: norm(r.joined_at) ?? "",
      }));
    }
    const startTime = attendees[0]?.joinedAt || norm(m.created_at) || "";
    const endTime = norm(m.ended_at) ?? "";
    const startMs = startTime ? new Date(startTime.replace(" ", "T")).getTime() : NaN;
    const endMs = endTime ? new Date(endTime.replace(" ", "T")).getTime() : NaN;
    return {
      meetingId: Number(m.id),
      code: String(m.code ?? ""),
      title: String(m.title ?? ""),
      hostName: String(m.host_name ?? ""),
      meetingType: m.scheduled_at ? "2" : "1",
      startTime,
      endTime,
      durationSec:
        Number.isFinite(startMs) && Number.isFinite(endMs)
          ? Math.max(0, Math.floor((endMs - startMs) / 1000))
          : 0,
      attendeeCount: attendees.length,
      attendees,
    };
  });

  // ── 待加入会议的实时推送（SSE） ──
  // EventSource 无法自定义请求头，故会话 id 经查询参数传入（与其它请求的
  // x-session-id 为同一凭据）。群组开会/点名邀请写入后由 notifyUser 触发。
  app.get("/meetings/my-invitations/stream", async (req, reply) => {
    const sid = (req.query as { sid?: string } | undefined)?.sid;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const stream = new Readable({ read() {} });
    const write = (chunk: string) => stream.push(chunk);
    write(": connected\n\n");

    const unsubscribe = subscribeUser(user.id, (notice) => {
      write(`data: ${JSON.stringify(notice)}\n\n`);
    });
    // 心跳：避免代理/负载均衡按空闲断开长连接
    const heartbeat = setInterval(() => write(": ping\n\n"), 25_000);
    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
      stream.push(null);
    };
    req.raw.on("close", cleanup);
    req.raw.on("error", cleanup);

    reply.header("Content-Type", "text/event-stream");
    reply.header("Cache-Control", "no-cache, no-transform");
    reply.header("X-Accel-Buffering", "no");
    return reply.send(stream);
  });

  app.get("/meetings/by-code/:code", async (req, reply) => {
    const code = (req.params as any).code as string;
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);

    const [rows] = await db.query(
      `SELECT id, code, title, host_user_id, status, waiting_room_enabled,
              scheduled_at, created_at, join_password_hash
       FROM meetings WHERE code = ? LIMIT 1`,
      [code],
    );
    const m = (rows as any[])[0];
    if (!m) return reply.code(404).send({ error: "meeting_not_found" });

    const hasPassword = Boolean(m.join_password_hash);
    const isHost =
      user != null && String(m.host_user_id) === String(user.id);
    return {
      id: Number(m.id),
      code: m.code,
      title: m.title,
      hostUserId: m.host_user_id == null ? null : Number(m.host_user_id),
      status: m.status,
      waitingRoomEnabled: !!m.waiting_room_enabled,
      scheduledAt: m.scheduled_at
        ? new Date(m.scheduled_at).toISOString()
        : null,
      createdAt: new Date(m.created_at).toISOString(),
      passwordRequired: hasPassword && !isHost,
    };
  });

  app.get("/meetings/:id", async (req, reply) => {
    const meetingId = Number((req.params as any).id);
    if (!Number.isFinite(meetingId)) {
      return reply.code(400).send({ error: "invalid_meeting_id" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const [rows] = await db.query(
      `SELECT id, code, title, status, waiting_room_enabled, scheduled_at,
              host_user_id, join_password_hash, created_at
       FROM meetings WHERE id = ? LIMIT 1`,
      [meetingId],
    );
    const m = (rows as any[])[0];
    if (!m) return reply.code(404).send({ error: "meeting_not_found" });
    const hasPassword = Boolean(m.join_password_hash);
    const isHost = String(m.host_user_id) === String(user.id);
    return {
      id: Number(m.id),
      code: m.code,
      title: m.title,
      status: m.status,
      waitingRoomEnabled: !!m.waiting_room_enabled,
      scheduledAt: m.scheduled_at
        ? new Date(m.scheduled_at).toISOString()
        : null,
      passwordRequired: hasPassword && !isHost,
    };
  });

  app.post("/meetings/:id/join-token", async (req, reply) => {
    const meetingId = Number((req.params as any).id);
    if (!Number.isFinite(meetingId)) {
      return reply.code(400).send({ error: "invalid_meeting_id" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const body = JoinTokenBodySchema.parse(req.body ?? {});

    const [rows] = await db.query(
      `SELECT * FROM meetings WHERE id = ? LIMIT 1`,
      [meetingId],
    );
    const m = (rows as any[])[0];
    if (!m) return reply.code(404).send({ error: "not_found" });
    if (m.status === "ended") return reply.code(409).send({ error: "ended" });
    // 锁定会议在加入弹窗即拦截：主持人不受限，其余成员不签发入会凭证（不跳转会议页）
    if (m.locked && String(m.host_user_id) !== String(user.id)) {
      return reply.code(403).send({ error: "meeting_locked" });
    }

    const allowed = await assertJoinPassword(m, user.id, body.password, reply);
    if (!allowed) return;

    await markLiveIfScheduled(db, meetingId, m.status);

    const role =
      String(m.host_user_id) === String(user.id) ? "host" : "participant";
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 6 * 3600 * 1000);
    await db.query(
      `INSERT INTO meeting_join_tokens (token, meeting_id, user_id, role, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [token, meetingId, user.id, role, expires],
    );
    return { token, role, meetingId };
  });

  app.post("/meetings/:id/guest-token", async (req, reply) => {
    const meetingId = Number((req.params as any).id);
    if (!Number.isFinite(meetingId)) {
      return reply.code(400).send({ error: "invalid_meeting_id" });
    }
    const raw = (req.body as any) ?? {};
    const displayName = zDisplayName.parse(raw.displayName);
    const password =
      typeof raw.password === "string" ? raw.password : undefined;

    const [rows] = await db.query(
      `SELECT * FROM meetings WHERE id = ? LIMIT 1`,
      [meetingId],
    );
    const m = (rows as any[])[0];
    if (!m) return reply.code(404).send({ error: "not_found" });
    if (m.status === "ended") return reply.code(409).send({ error: "ended" });
    // 锁定会议对访客一律拦截（访客不可能是主持人）
    if (m.locked) {
      return reply.code(403).send({ error: "meeting_locked" });
    }

    const allowed = await assertJoinPassword(m, null, password, reply);
    if (!allowed) return;

    await markLiveIfScheduled(db, meetingId, m.status);

    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 6 * 3600 * 1000);
    await db.query(
      `INSERT INTO meeting_join_tokens
       (token, meeting_id, user_id, role, display_name, expires_at)
       VALUES (?, ?, NULL, 'guest', ?, ?)`,
      [token, meetingId, displayName, expires],
    );
    return { token, role: "guest", meetingId, displayName };
  });

  // ── 邀请名单：查看某会议的邀请人员 ──
  app.get("/meetings/:id/invitations", async (req, reply) => {
    const meetingId = Number((req.params as any).id);
    if (!Number.isFinite(meetingId)) {
      return reply.code(400).send({ error: "invalid_meeting_id" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    // 仅主持人 / 管理后台角色可查看邀请名单
    if (!(await assertMeetingManageAccess(db, reply, user, meetingId))) return;

    try {
      const [rows] = await db.query(
        `SELECT i.id, i.meeting_id, i.user_id, i.dept_id, i.display_name, i.status, i.invited_at, i.joined_at,
                d.dept_name
         FROM meeting_invitations i
         LEFT JOIN sys_dept d ON d.dept_id = i.dept_id
         WHERE i.meeting_id = ?
         ORDER BY i.invited_at ASC`,
        [meetingId],
      );
      const items = (rows as any[]).map((r) => ({
        id: Number(r.id),
        meetingId: Number(r.meeting_id),
        userId: r.user_id == null ? null : Number(r.user_id),
        deptId: r.dept_id == null ? null : Number(r.dept_id),
        deptName: r.dept_name ?? null,
        displayName: r.display_name,
        status: r.status,
        invitedAt: r.invited_at ? new Date(r.invited_at).toISOString() : null,
        joinedAt: r.joined_at ? new Date(r.joined_at).toISOString() : null,
      }));
      return { items };
    } catch {
      // 表可能不存在
      return { items: [] };
    }
  });

  // ── 邀请人员加入会议 ──
  app.post("/meetings/:id/invite", async (req, reply) => {
    const meetingId = Number((req.params as any).id);
    if (!Number.isFinite(meetingId)) {
      return reply.code(400).send({ error: "invalid_meeting_id" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    // 仅主持人 / 管理后台角色可邀请他人入会
    if (!(await assertMeetingManageAccess(db, reply, user, meetingId))) return;

    const body = (req.body as any) ?? {};
    const userIds: number[] = Array.isArray(body.userIds) ? body.userIds : [];
    const deptIds: number[] = Array.isArray(body.deptIds) ? body.deptIds : [];

    const invitePrefix = insertIgnorePrefix(db); // INSERT OR IGNORE / INSERT IGNORE / INSERT INTO
    const inviteSuffix = conflictSuffix(db, "meeting_id, user_id"); // PG: ON CONFLICT DO NOTHING

    let invited = 0;
    const notified = new Set<number>();
    for (const uid of userIds) {
      try {
        const [uRows] = await db.query(
          `SELECT nick_name FROM sys_user WHERE user_id = ? LIMIT 1`,
          [uid],
        );
        const uName = (uRows as any[])[0]?.nick_name ?? `用户${uid}`;
        await db.query(
          `${invitePrefix} INTO meeting_invitations (meeting_id, user_id, display_name, status, invited_at)
           VALUES (?, ?, ?, 'pending', ${nowSql(db)}) ${inviteSuffix}`,
          [meetingId, uid, uName],
        );
        invited++;
        notified.add(Number(uid));
      } catch { /* ignore */ }
    }

    for (const did of deptIds) {
      try {
        const [dRows] = await db.query(
          `SELECT u.user_id, u.nick_name FROM sys_user u WHERE u.dept_id = ? AND u.del_flag = '0'`,
          [did],
        );
        for (const u of dRows as any[]) {
          await db.query(
            `${invitePrefix} INTO meeting_invitations (meeting_id, user_id, dept_id, display_name, status, invited_at)
             VALUES (?, ?, ?, ?, 'pending', ${nowSql(db)}) ${inviteSuffix}`,
            [meetingId, u.user_id, did, u.nick_name],
          );
          invited++;
          notified.add(Number(u.user_id));
        }
      } catch { /* ignore */ }
    }

    // 实时推送：通知被邀请人刷新“待加入会议”
    for (const uid of notified) {
      notifyUser(uid, { type: "invitations_changed", meetingId });
    }

    return { meetingId, invited };
  });

  // ── 参会者列表（信令服务维护，通过 HTTP 代理查询） ──
  app.get("/meetings/:id/attendees", async (req, reply) => {
    const meetingId = Number((req.params as any).id);
    if (!Number.isFinite(meetingId)) {
      return reply.code(400).send({ error: "invalid_meeting_id" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    // 仅主持人 / 管理后台角色可查看参会者明细
    if (!(await assertMeetingManageAccess(db, reply, user, meetingId))) return;

    // 查询实际参会者（meeting_attendance 覆盖凭号加入/访客），回退邀请名单
    try {
      const [attRows] = await db.query(
        `SELECT display_name FROM meeting_attendance WHERE meeting_id = ? ORDER BY joined_at ASC`,
        [meetingId],
      );
      if ((attRows as any[]).length > 0) {
        return {
          items: (attRows as any[]).map((r) => ({
            peerId: "",
            displayName: r.display_name,
            role: "participant",
            handRaised: false,
          })),
        };
      }
      const [rows] = await db.query(
        `SELECT display_name, status FROM meeting_invitations WHERE meeting_id = ? AND status = 'attended'`,
        [meetingId],
      );
      const items = (rows as any[]).map((r) => ({
        peerId: "",
        displayName: r.display_name,
        role: "participant",
        handRaised: false,
      }));
      return { items };
    } catch {
      return { items: [] };
    }
  });

  // ── 更新邀请状态（接受/拒绝）──
  app.patch("/meetings/:id/invitations/:invId", async (req, reply) => {
    const meetingId = Number((req.params as any).id);
    const invId = Number((req.params as any).invId);
    if (!Number.isFinite(meetingId) || !Number.isFinite(invId)) {
      return reply.code(400).send({ error: "invalid_params" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const { status } = req.body as { status?: string };
    if (!status || !["accepted", "rejected", "pending"].includes(status)) {
      return reply.code(400).send({ error: "invalid_status" });
    }

    // 验证：用户只能更新自己的邀请
    const [rows] = await db.query(
      `SELECT user_id FROM meeting_invitations WHERE id = ? AND meeting_id = ? LIMIT 1`,
      [invId, meetingId],
    );
    const inv = (rows as any[])[0];
    if (!inv) return reply.code(404).send({ error: "not_found" });
    if (Number(inv.user_id) !== Number(user.id) && !user.roles.includes("admin")) {
      return reply.code(403).send({ error: "forbidden" });
    }

    await db.query(
      `UPDATE meeting_invitations SET status = ? WHERE id = ?`,
      [status, invId],
    );
    return { id: invId, status };
  });

  // ── 管理员：在线会议列表 ──
  app.get("/admin/meetings/online", async (req, reply) => {
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    // 兼容式接入菜单权限码：勾选「会议监控」菜单的角色亦可访问（存量管理角色不受影响）
    if (!isManagerRole(user) && !user.permissions.includes("meeting:monitor:list"))
      return reply.code(403).send({ error: "forbidden" });

    try {
      const [rows] = await db.query(
        `SELECT m.id, m.code, m.title, m.status, m.host_user_id,
                COUNT(CASE WHEN i.status = 'attended' THEN 1 END) AS online_count,
                COUNT(i.id) AS invited_count
         FROM meetings m
         LEFT JOIN meeting_invitations i ON i.meeting_id = m.id
         WHERE m.status = 'live'
         GROUP BY m.id
         ORDER BY m.created_at DESC`,
      );
      const items = (rows as any[]).map((m) => ({
        meetingId: Number(m.id),
        code: m.code,
        title: m.title,
        status: m.status,
        onlineCount: Number(m.online_count ?? 0),
        invitedCount: Number(m.invited_count ?? 0),
      }));
      return { items };
    } catch {
      // 表可能不存在
      return { items: [] };
    }
  });

  // ── 管理员：会议参会者明细 ──
  app.get("/admin/meetings/:id/attendees", async (req, reply) => {
    const meetingId = Number((req.params as any).id);
    if (!Number.isFinite(meetingId)) {
      return reply.code(400).send({ error: "invalid_meeting_id" });
    }
    const sessionId = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sessionId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!isManagerRole(user) && !user.permissions.includes("meeting:monitor:list"))
      return reply.code(403).send({ error: "forbidden" });

    try {
      const [rows] = await db.query(
        `SELECT i.display_name, i.status, i.joined_at, i.user_id,
                u.dept_id, d.dept_name
         FROM meeting_invitations i
         LEFT JOIN sys_user u ON u.user_id = i.user_id
         LEFT JOIN sys_dept d ON d.dept_id = u.dept_id
         WHERE i.meeting_id = ?
         ORDER BY i.status ASC, i.invited_at ASC`,
        [meetingId],
      );
      const items = (rows as any[]).map((r) => ({
        displayName: r.display_name,
        status: r.status,
        joinedAt: r.joined_at ? new Date(r.joined_at).toISOString() : null,
        deptId: r.dept_id ?? null,
        deptName: r.dept_name ?? null,
      }));
      // 合并实际参会记录中"凭会议号直接加入"的成员/访客（不在邀请名单里）
      const [attRows] = await db.query(
        `SELECT display_name, is_guest, joined_at FROM meeting_attendance WHERE meeting_id = ?`,
        [meetingId],
      );
      const invitedIds = new Set(
        (rows as any[]).map((r) => (r.user_id == null ? `g:${r.display_name}` : String(r.user_id)))
      );
      for (const a of attRows as any[]) {
        const key = a.user_id == null ? `g:${a.display_name}` : String(a.user_id);
        if (invitedIds.has(key)) continue;
        items.push({
          displayName: a.display_name,
          status: "attended",
          joinedAt: a.joined_at ? new Date(a.joined_at).toISOString() : null,
          deptId: null,
          deptName: null,
        });
      }
      return { items };
    } catch {
      return { items: [] };
    }
  });
}
