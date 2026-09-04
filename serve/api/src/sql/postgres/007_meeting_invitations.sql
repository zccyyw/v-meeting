-- ============================================================
-- 007: 会议邀请名单 + 常用群组
-- 兼容 PostgreSQL
-- ============================================================

-- ── 1. 会议邀请名单 ──
CREATE TABLE IF NOT EXISTS meeting_invitations (
  id           BIGSERIAL PRIMARY KEY,
  meeting_id   BIGINT NOT NULL,
  user_id      BIGINT,
  dept_id      BIGINT,
  display_name VARCHAR(100),
  status       VARCHAR(20) DEFAULT 'pending',
  invited_at   TIMESTAMPTZ DEFAULT NOW(),
  joined_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meeting_invitations_meeting ON meeting_invitations(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_invitations_user ON meeting_invitations(user_id);

-- ── 2. 常用群组 ──
CREATE TABLE IF NOT EXISTS meeting_groups (
  group_id   BIGSERIAL PRIMARY KEY,
  group_name VARCHAR(50) NOT NULL,
  owner_id   BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_groups_owner ON meeting_groups(owner_id);

-- ── 3. 群组成员 ──
CREATE TABLE IF NOT EXISTS meeting_group_members (
  id       BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id  BIGINT,
  dept_id  BIGINT
);

CREATE INDEX IF NOT EXISTS idx_meeting_group_members_group ON meeting_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_meeting_group_members_user ON meeting_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_group_members_dept ON meeting_group_members(dept_id);
