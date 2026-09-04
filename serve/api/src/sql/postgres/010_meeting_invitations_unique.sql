-- ============================================================
-- 010: meeting_invitations 唯一约束（meeting_id + user_id）
-- 兼容 PostgreSQL
-- ============================================================

-- 防止同一会议重复邀请同一用户（user_id 为 NULL 的部门邀请不受约束，PostgreSQL 中 NULL 不参与唯一性检查）
CREATE UNIQUE INDEX IF NOT EXISTS uk_meeting_invitations_meeting_user ON meeting_invitations(meeting_id, user_id);
