-- ============================================================
-- 008: 安全合规模块 — 三员角色 + 用户审批 + 配置项
-- 兼容 MySQL
-- ============================================================

-- ── 1. 三员角色种子数据 ──
INSERT INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
SELECT 3, '系统管理员', 'sys_admin', 3, '1', '0', '0', 'admin', NOW(), '系统设置管理，添加机构、用户'
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE role_id = 3);

INSERT INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
SELECT 4, '授权管理员', 'auth_admin', 4, '1', '0', '0', 'admin', NOW(), '审核用户增删改操作，查看登录日志'
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE role_id = 4);

INSERT INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
SELECT 5, '审计管理员', 'audit_admin', 5, '1', '0', '0', 'admin', NOW(), '查看所有账号登录操作日志'
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE role_id = 5);

-- ── 2. 三员角色菜单权限 ──
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 100);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1000);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1001);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1002);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 103);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1016);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1017);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1018);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 106);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1024);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1025);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1026);

INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 1);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 100);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 1000);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 108);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 500);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 1032);

INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 1);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 108);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 500);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 1032);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 1033);
INSERT IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 1034);

-- ── 3. 用户操作审批表 ──
CREATE TABLE IF NOT EXISTS sys_user_approval (
  approval_id    BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_type   VARCHAR(20) NOT NULL,
  target_user_id BIGINT,
  requester_id   BIGINT NOT NULL,
  requester_data TEXT,
  status         VARCHAR(20) DEFAULT 'pending',
  approver_id    BIGINT,
  approve_time   DATETIME,
  reject_reason  VARCHAR(500),
  create_time    DATETIME DEFAULT NOW()
) ENGINE=InnoDB COMMENT='用户操作审批表';

CREATE INDEX idx_sys_user_approval_status ON sys_user_approval (status);
CREATE INDEX idx_sys_user_approval_requester ON sys_user_approval (requester_id);

-- ── 4. sys_oper_log 扩展字段 ──
-- MySQL 不支持 ADD COLUMN IF NOT EXISTS，通过 migrate.ts 中的
-- migrateOperLogExtensions 函数用 information_schema 检查后安全添加。
-- 此处不做 ALTER TABLE，避免重复执行报错。

-- ── 5. 安全相关配置项 ──
INSERT INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark) VALUES
(10, '密码最小长度', 'sys.password.minLength', '10', 'Y', 'admin', NOW(), '密码最小字符数'),
(11, '密码最大长度', 'sys.password.maxLength', '128', 'Y', 'admin', NOW(), '密码最大字符数'),
(12, '密码需要大写字母', 'sys.password.requireUpper', 'true', 'Y', 'admin', NOW(), '密码是否必须包含大写字母'),
(13, '密码需要小写字母', 'sys.password.requireLower', 'true', 'Y', 'admin', NOW(), '密码是否必须包含小写字母'),
(14, '密码需要数字', 'sys.password.requireDigit', 'true', 'Y', 'admin', NOW(), '密码是否必须包含数字'),
(15, '密码需要特殊字符', 'sys.password.requireSpecial', 'true', 'Y', 'admin', NOW(), '密码是否必须包含特殊字符'),
(16, '密码特殊字符集', 'sys.password.specialChars', '!@#$%^&*()_+-=[]{}|;:,.<>?/', 'Y', 'admin', NOW(), '允许的特殊字符集合'),
(17, '密码过期天数', 'sys.password.expireDays', '15', 'Y', 'admin', NOW(), '密码过期天数（0=不过期）'),
(18, '密码禁止复用', 'sys.password.preventReuse', 'true', 'Y', 'admin', NOW(), '是否禁止与旧密码相同'),
(19, '默认密码列表', 'sys.password.defaultPasswords', '123456,admin123,Admin@123', 'Y', 'admin', NOW(), '逗号分隔的默认密码列表'),
(20, '空闲超时秒数', 'sys.session.idleTimeout', '600', 'Y', 'admin', NOW(), '页面空闲自动退出秒数（默认600=10分钟）'),
(21, '超时前提醒秒数', 'sys.session.idleWarning', '60', 'Y', 'admin', NOW(), '超时前弹窗提醒秒数'),
(22, '登录最大失败次数', 'sys.login.maxAttempts', '5', 'Y', 'admin', NOW(), '连续登录失败最大次数'),
(23, '登录锁定时长', 'sys.login.lockDuration', '60', 'Y', 'admin', NOW(), '账户锁定时长（秒）'),
(24, '日志保留天数', 'sys.log.retentionDays', '365', 'Y', 'admin', NOW(), '操作日志保留天数'),
(25, '存储空间阈值', 'sys.log.storageThreshold', '80', 'Y', 'admin', NOW(), '存储空间阈值（百分比）'),
(26, '同时在线人数上限', 'sys.online.maxUsers', '20', 'Y', 'admin', NOW(), '同时在线人数上限')
ON DUPLICATE KEY UPDATE config_id = config_id;
