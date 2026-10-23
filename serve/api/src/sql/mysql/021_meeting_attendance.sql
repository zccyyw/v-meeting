-- 021: 实际参会记录——修正历史会议参会人数口径。
-- 此前人数按 meeting_invitations(status='attended') 统计，仅覆盖受邀流程；
-- 凭会议号直接加入的成员与访客不入邀请表，导致人数恒为 1。
-- realtime 在每次准入成功时写入本表（登录用户按 meeting_id+user_id 去重，
-- 访客 user_id 为 NULL、由应用层按显示名去重）；统计与明细均以本表为准。
-- 幂等：重复执行为空操作。
CREATE TABLE IF NOT EXISTS meeting_attendance (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id   BIGINT NOT NULL,
  user_id      BIGINT UNSIGNED NULL,
  display_name VARCHAR(100) NOT NULL,
  is_guest     TINYINT(1) NOT NULL DEFAULT 0,
  joined_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_meeting_attendance (meeting_id, user_id),
  INDEX idx_meeting_attendance_meeting (meeting_id)
) ENGINE=InnoDB COMMENT='会议实际参会记录（含凭号加入与访客）';
