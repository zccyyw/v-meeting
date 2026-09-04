-- ============================================================
-- 008: 安全合规模块 — 三员角色 + 用户审批 + sys_oper_log 扩展 + 配置项
-- 兼容 SQLite
-- ============================================================

-- ── 1. 三员角色种子数据 ──
INSERT OR IGNORE INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
VALUES (3, '系统管理员', 'sys_admin', 3, '1', '0', '0', 'admin', datetime('now'), '系统设置管理，添加机构、用户');

INSERT OR IGNORE INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
VALUES (4, '授权管理员', 'auth_admin', 4, '1', '0', '0', 'admin', datetime('now'), '审核用户增删改操作，查看登录日志');

INSERT OR IGNORE INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
VALUES (5, '审计管理员', 'audit_admin', 5, '1', '0', '0', 'admin', datetime('now'), '查看所有账号登录操作日志');

-- ── 2. 三员角色菜单权限 ──
-- 系统管理员：用户管理(查询/新增/编辑) + 部门管理 + 参数设置
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1);   -- 系统管理目录
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 100); -- 用户管理
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1000); -- 用户查询
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1001); -- 用户新增
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1002); -- 用户修改
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 103);  -- 部门管理
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1016); -- 部门查询
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1017); -- 部门新增
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1018); -- 部门修改
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 106);  -- 参数设置
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1024); -- 参数查询
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1025); -- 参数新增
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (3, 1026); -- 参数修改

-- 授权管理员：用户审批 + 登录日志查询
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 1);   -- 系统管理目录
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 100); -- 用户管理
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 1000); -- 用户查询
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 108); -- 日志管理目录
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 500); -- 操作日志
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (4, 1032); -- 日志查询

-- 审计管理员：全量日志查询/导出
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 1);   -- 系统管理目录
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 108); -- 日志管理目录
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 500); -- 操作日志
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 1032); -- 日志查询
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 1033); -- 日志删除
INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (5, 1034); -- 日志导出

-- ── 3. 用户操作审批表 ──
CREATE TABLE IF NOT EXISTS sys_user_approval (
  approval_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type   TEXT NOT NULL,
  target_user_id INTEGER,
  requester_id   INTEGER NOT NULL,
  requester_data TEXT,
  status         TEXT DEFAULT 'pending',
  approver_id    INTEGER,
  approve_time   TEXT,
  reject_reason  TEXT,
  create_time    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sys_user_approval_status ON sys_user_approval (status);
CREATE INDEX IF NOT EXISTS idx_sys_user_approval_requester ON sys_user_approval (requester_id);

-- ── 4. sys_oper_log 表扩展字段 ──
-- 使用 ALTER TABLE ADD COLUMN（SQLite 支持 IF NOT EXISTS 语义通过 PRAGMA 检查）
-- SQLite 不支持 ADD COLUMN IF NOT EXISTS，需在 migrate.ts 中特殊处理
-- 此处仅做安全添加（重复执行会报错但 migrate.ts 会捕获）

-- ── 5. 安全相关配置项 ──
INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (10, '密码最小长度', 'sys.password.minLength', '10', 'Y', 'admin', datetime('now'), '密码最小字符数');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (11, '密码最大长度', 'sys.password.maxLength', '128', 'Y', 'admin', datetime('now'), '密码最大字符数');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (12, '密码需要大写字母', 'sys.password.requireUpper', 'true', 'Y', 'admin', datetime('now'), '密码是否必须包含大写字母');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (13, '密码需要小写字母', 'sys.password.requireLower', 'true', 'Y', 'admin', datetime('now'), '密码是否必须包含小写字母');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (14, '密码需要数字', 'sys.password.requireDigit', 'true', 'Y', 'admin', datetime('now'), '密码是否必须包含数字');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (15, '密码需要特殊字符', 'sys.password.requireSpecial', 'true', 'Y', 'admin', datetime('now'), '密码是否必须包含特殊字符');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (16, '密码特殊字符集', 'sys.password.specialChars', '!@#$%^&*()_+-=[]{}|;:,.<>?/', 'Y', 'admin', datetime('now'), '允许的特殊字符集合');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (17, '密码过期天数', 'sys.password.expireDays', '15', 'Y', 'admin', datetime('now'), '密码过期天数（0=不过期）');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (18, '密码禁止复用', 'sys.password.preventReuse', 'true', 'Y', 'admin', datetime('now'), '是否禁止与旧密码相同');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (19, '默认密码列表', 'sys.password.defaultPasswords', '123456,admin123,Admin@123', 'Y', 'admin', datetime('now'), '逗号分隔的默认密码列表');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (20, '空闲超时秒数', 'sys.session.idleTimeout', '600', 'Y', 'admin', datetime('now'), '页面空闲自动退出秒数（默认600=10分钟）');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (21, '超时前提醒秒数', 'sys.session.idleWarning', '60', 'Y', 'admin', datetime('now'), '超时前弹窗提醒秒数');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (22, '登录最大失败次数', 'sys.login.maxAttempts', '5', 'Y', 'admin', datetime('now'), '连续登录失败最大次数');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (23, '登录锁定时长', 'sys.login.lockDuration', '60', 'Y', 'admin', datetime('now'), '账户锁定时长（秒）');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (24, '日志保留天数', 'sys.log.retentionDays', '365', 'Y', 'admin', datetime('now'), '操作日志保留天数');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (25, '存储空间阈值', 'sys.log.storageThreshold', '80', 'Y', 'admin', datetime('now'), '存储空间阈值（百分比）');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (26, '同时在线人数上限', 'sys.online.maxUsers', '20', 'Y', 'admin', datetime('now'), '同时在线人数上限');
