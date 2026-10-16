-- 018: 通知公告定向化——指定用户/部门接收 + 已读状态。
-- 1) sys_notice_target：通知(type=1)的接收范围（部门/用户）；无 target 的 type=1 存量通知按全员兼容。
-- 2) sys_notice_read：C 端用户已读状态（首页铃铛未读角标）。
-- 幂等：重复执行为空操作。
CREATE TABLE IF NOT EXISTS sys_notice_target (
  id          BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  notice_id   BIGINT NOT NULL,
  target_type VARCHAR(10) NOT NULL,
  target_id   BIGINT NOT NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sys_notice_target (notice_id, target_type, target_id),
  INDEX idx_sys_notice_target_target (target_type, target_id)
) ENGINE=InnoDB COMMENT='通知公告接收范围表';

CREATE TABLE IF NOT EXISTS sys_notice_read (
  id        BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  notice_id BIGINT NOT NULL,
  user_id   BIGINT NOT NULL,
  read_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sys_notice_read (notice_id, user_id)
) ENGINE=InnoDB COMMENT='通知公告已读状态表';
