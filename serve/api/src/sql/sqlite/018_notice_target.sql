-- 018: 通知公告定向化——指定用户/部门接收 + 已读状态。
-- 1) sys_notice_target：通知(type=1)的接收范围（部门/用户）；无 target 的 type=1 存量通知按全员兼容。
-- 2) sys_notice_read：C 端用户已读状态（首页铃铛未读角标）。
-- 幂等：重复执行为空操作。
CREATE TABLE IF NOT EXISTS sys_notice_target (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  notice_id   INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id   INTEGER NOT NULL,
  create_time TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (notice_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_sys_notice_target_target ON sys_notice_target(target_type, target_id);

CREATE TABLE IF NOT EXISTS sys_notice_read (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  notice_id INTEGER NOT NULL,
  user_id   INTEGER NOT NULL,
  read_time TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (notice_id, user_id)
);
