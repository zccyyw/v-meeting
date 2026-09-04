-- ============================================================
-- 007: 会议邀请名单 + 常用群组
-- 兼容 SQLite
-- ============================================================

-- ── 1. 会议邀请名单 ──
CREATE TABLE IF NOT EXISTS meeting_invitations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id   INTEGER NOT NULL,
  user_id      INTEGER,
  dept_id      INTEGER,
  display_name TEXT,
  status       TEXT DEFAULT 'pending',
  invited_at   TEXT DEFAULT (datetime('now')),
  joined_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_meeting_invitations_meeting ON meeting_invitations(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_invitations_user ON meeting_invitations(user_id);

-- ── 2. 常用群组 ──
CREATE TABLE IF NOT EXISTS meeting_groups (
  group_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name TEXT NOT NULL,
  owner_id   INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_meeting_groups_owner ON meeting_groups(owner_id);

-- ── 3. 群组成员 ──
CREATE TABLE IF NOT EXISTS meeting_group_members (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id  INTEGER,
  dept_id  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_meeting_group_members_group ON meeting_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_meeting_group_members_user ON meeting_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_group_members_dept ON meeting_group_members(dept_id);
