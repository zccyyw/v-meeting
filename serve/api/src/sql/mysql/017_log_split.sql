-- 017: 日志体系拆分——登录日志独立菜单 + 会议开会日志。
-- 1) 菜单：501 登录日志(C, parent=108 日志管理) + 502/503/504 按钮；
--    301 会议日志(C, parent=108) + 302/303/304 按钮。
-- 2) 角色预授权：
--    授权管理员(4) +501..504，回收其 500/1032（登录日志拆分后授权管理员回归登录安全本职）；
--    审计管理员(5) +501..504 +301..304（审计看所有日志）；
--    系统管理员(3) +301..304（会议日志归系统管理）。
-- 3) 新表 sys_meeting_log：会议结束时落一条开会记录快照（参会人数按邀请记录统计）。
-- admin 分支查全表无需预授权。幂等：重复执行为空操作。
INSERT IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, menu_type, visible, status, perms, icon)
VALUES (501, '登录日志', 108, 2, 'loginlog', 'C', '0', '0', 'system:loginlog:list', 'LoginOutlined');
INSERT IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, menu_type, visible, status, perms)
VALUES (502, '登录日志查询', 501, 1, 'F', '0', '0', 'system:loginlog:query');
INSERT IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, menu_type, visible, status, perms)
VALUES (503, '登录日志清空', 501, 2, 'F', '0', '0', 'system:loginlog:remove');
INSERT IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, menu_type, visible, status, perms)
VALUES (504, '登录日志导出', 501, 3, 'F', '0', '0', 'system:loginlog:export');
INSERT IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, menu_type, visible, status, perms, icon)
VALUES (301, '会议日志', 108, 3, 'meeting-log', 'C', '0', '0', 'meeting:meetinglog:list', 'AuditOutlined');
INSERT IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, menu_type, visible, status, perms)
VALUES (302, '会议日志查询', 301, 1, 'F', '0', '0', 'meeting:meetinglog:query');
INSERT IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, menu_type, visible, status, perms)
VALUES (303, '会议日志清空', 301, 2, 'F', '0', '0', 'meeting:meetinglog:remove');
INSERT IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, menu_type, visible, status, perms)
VALUES (304, '会议日志导出', 301, 3, 'F', '0', '0', 'meeting:meetinglog:export');

-- 角色预授权（新增）
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 501);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 502);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 503);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 504);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 501);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 502);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 503);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 504);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 301);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 302);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 303);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 304);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 301);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 302);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 303);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 304);

-- 回收授权管理员的操作日志权限（登录日志拆分后权限边界调整）
DELETE FROM sys_role_menu WHERE role_id = 4 AND menu_id IN (500, 1032);

-- ── 会议开会日志表 ──
CREATE TABLE IF NOT EXISTS sys_meeting_log (
  log_id            BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id        BIGINT NOT NULL,
  meeting_code      VARCHAR(64),
  title             VARCHAR(255),
  meeting_type      CHAR(1) NOT NULL DEFAULT '1',
  host_name         VARCHAR(64),
  start_time        DATETIME,
  end_time          DATETIME,
  duration_sec      INT NOT NULL DEFAULT 0,
  participant_count INT NOT NULL DEFAULT 0,
  create_time       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sys_meeting_log_meeting (meeting_id),
  INDEX idx_sys_meeting_log_time (start_time),
  INDEX idx_sys_meeting_log_type (meeting_type)
) ENGINE=InnoDB COMMENT='会议开会日志表';
