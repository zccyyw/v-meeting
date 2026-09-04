import type { Db } from "./db.js";
import type { UserRole } from "@meeting/shared";

export type JoinAuth = {
  meetingId: string;
  userId: string | null;
  role: UserRole;
  displayName: string | null;
  waitingRoomEnabled: boolean;
  recordAllowed: boolean;
  meetingStatus: string;
};

export async function validateJoinToken(db: Db, token: string): Promise<JoinAuth | null> {
  const [rows] = await db.query(
    `SELECT t.meeting_id, t.user_id, t.role, t.display_name, t.expires_at,
            m.waiting_room_enabled, m.record_allowed, m.status, m.title
     FROM meeting_join_tokens t
     JOIN meetings m ON m.id = t.meeting_id
     WHERE t.token = ? LIMIT 1`,
    [token]
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (row.status === "ended") return null;
  return {
    meetingId: String(row.meeting_id),
    userId: row.user_id == null ? null : String(row.user_id),
    role: row.role,
    displayName: row.display_name,
    waitingRoomEnabled: !!row.waiting_room_enabled,
    recordAllowed: !!row.record_allowed,
    meetingStatus: row.status,
  };
}
