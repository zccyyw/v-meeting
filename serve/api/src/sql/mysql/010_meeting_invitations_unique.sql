-- ============================================================
-- 010: meeting_invitations 唯一约束（meeting_id + user_id）
-- 兼容 MySQL
-- ============================================================

-- 防止同一会议重复邀请同一用户（user_id 为 NULL 的部门邀请不受约束）
ALTER TABLE meeting_invitations ADD UNIQUE INDEX uk_meeting_user (meeting_id, user_id);
