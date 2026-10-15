import type { FastifyInstance } from "fastify";
import type { Db } from "../db.js";
import type { Redis } from "ioredis";
import { loadSessionUser } from "../session-user.js";

/**
 * 会议开会日志路由：查询 sys_meeting_log（由 realtime 服务在会议结束时写入）。
 * 三员分立：系统管理员 / 审计管理员 / admin 可查。
 */
type MeetingLogRow = {
  log_id: number | string;
  meeting_id: number | string;
  meeting_code: string | null;
  title: string | null;
  meeting_type: string;
  host_name: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_sec: number;
  participant_count: number;
  create_time: string;
};

function mapRow(row: MeetingLogRow) {
  return {
    logId: Number(row.log_id),
    meetingId: Number(row.meeting_id),
    meetingCode: row.meeting_code ?? "",
    title: row.title ?? "",
    meetingType: row.meeting_type,
    hostName: row.host_name ?? "",
    startTime: row.start_time ?? "",
    endTime: row.end_time ?? "",
    durationSec: Number(row.duration_sec) || 0,
    participantCount: Number(row.participant_count) || 0,
    createTime: row.create_time,
  };
}

function limitClause(db: Db, page: number, pageSize: number): string {
  const offset = (page - 1) * pageSize;
  return `LIMIT ${pageSize} OFFSET ${offset}`;
}

function buildWhere(q: {
  title?: string;
  meetingCode?: string;
  meetingType?: string;
  hostName?: string;
}): { where: string; params: unknown[] } {
  let where = `WHERE 1=1`;
  const params: unknown[] = [];
  if (q.title) { where += ` AND title LIKE ?`; params.push(`%${q.title}%`); }
  if (q.meetingCode) { where += ` AND meeting_code LIKE ?`; params.push(`%${q.meetingCode}%`); }
  if (q.meetingType) { where += ` AND meeting_type = ?`; params.push(q.meetingType); }
  if (q.hostName) { where += ` AND host_name LIKE ?`; params.push(`%${q.hostName}%`); }
  return { where, params };
}

function hasReadAccess(user: { roles: string[]; permissions: string[] }, perm: string): boolean {
  return (
    user.roles.includes("admin") ||
    user.roles.includes("sys_admin") ||
    user.roles.includes("audit_admin") ||
    user.permissions.includes(perm)
  );
}

export async function meetingLogRoutes(app: FastifyInstance, db: Db, redis: Redis) {
  // ── 列表（分页 + 筛选）──
  app.get("/sys-meetinglog/list", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!hasReadAccess(user, "meeting:meetinglog:list"))
      return reply.code(403).send({ error: "forbidden" });

    const q = req.query as {
      title?: string;
      meetingCode?: string;
      meetingType?: string;
      hostName?: string;
      page?: string;
      pageSize?: string;
    };
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 20);

    const { where, params } = buildWhere(q);
    const [countRows] = await db.query(`SELECT COUNT(*) AS total FROM sys_meeting_log ${where}`, params);
    const total = Number((countRows as { total: number | string }[])[0].total);

    const [rows] = await db.query(
      `SELECT * FROM sys_meeting_log ${where} ORDER BY log_id DESC ${limitClause(db, page, pageSize)}`,
      params,
    );
    const items = (rows as MeetingLogRow[]).map(mapRow);
    return { items, total, page, pageSize };
  });

  // ── 详情 ──
  app.get("/sys-meetinglog/:id", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!hasReadAccess(user, "meeting:meetinglog:query"))
      return reply.code(403).send({ error: "forbidden" });

    const id = Number((req.params as { id: string }).id);
    const [rows] = await db.query(`SELECT * FROM sys_meeting_log WHERE log_id = ? LIMIT 1`, [id]);
    const row = (rows as MeetingLogRow[])[0];
    if (!row) return reply.code(404).send({ error: "not_found" });
    return mapRow(row);
  });

  // ── 导出（CSV）──
  app.get("/sys-meetinglog/export", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (!hasReadAccess(user, "meeting:meetinglog:export"))
      return reply.code(403).send({ error: "forbidden" });

    const q = req.query as {
      title?: string;
      meetingCode?: string;
      meetingType?: string;
      hostName?: string;
    };
    const { where, params } = buildWhere(q);
    const [rows] = await db.query(
      `SELECT * FROM sys_meeting_log ${where} ORDER BY log_id DESC LIMIT 10000`,
      params,
    );

    const headers = ["日志ID", "会议主题", "会议类型", "会议号", "主持人", "参会人数", "开始时间", "结束时间", "时长(秒)", "记录时间"];
    const lines = [headers.join(",")];
    for (const row of rows as MeetingLogRow[]) {
      const line = [
        row.log_id,
        `"${(row.title ?? "").replace(/"/g, '""')}"`,
        row.meeting_type === "2" ? "预约会议" : "快速会议",
        `"${row.meeting_code ?? ""}"`,
        `"${row.host_name ?? ""}"`,
        row.participant_count,
        `"${row.start_time ?? ""}"`,
        `"${row.end_time ?? ""}"`,
        row.duration_sec,
        `"${row.create_time ?? ""}"`,
      ];
      lines.push(line.join(","));
    }

    const csv = "\uFEFF" + lines.join("\n");
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="meetinglog-${Date.now()}.csv"`);
    return reply.send(csv);
  });

  // ── 清空 ──
  app.delete("/sys-meetinglog/clean", async (req, reply) => {
    const sid = req.headers["x-session-id"] as string | undefined;
    const user = await loadSessionUser(db, redis, sid);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if (
      !user.roles.includes("admin") &&
      !user.roles.includes("sys_admin") &&
      !user.permissions.includes("meeting:meetinglog:remove")
    )
      return reply.code(403).send({ error: "forbidden" });

    await db.query(`DELETE FROM sys_meeting_log`);
    return reply.code(204).send();
  });
}
