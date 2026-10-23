-- 021: 实际参会记录（说明同 mysql 版）。
CREATE TABLE IF NOT EXISTS meeting_attendance (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id   INTEGER NOT NULL,
  user_id      INTEGER,
  display_name TEXT NOT NULL,
  is_guest     INTEGER NOT NULL DEFAULT 0,
  joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_meeting ON meeting_attendance(meeting_id);
