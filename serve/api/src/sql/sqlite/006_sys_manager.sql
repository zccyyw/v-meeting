-- ============================================================
-- 006: 系统管理模块 — 严格对齐若依 sys_x 表结构
-- 表：sys_dept, sys_role, sys_menu, sys_user_role, sys_role_menu,
--     sys_config, sys_notice, sys_oper_log
-- 注：users → sys_user 的重命名在 migrate.ts 中特殊处理
-- ============================================================

-- ── 1. 部门表 ──
CREATE TABLE IF NOT EXISTS sys_dept (
  dept_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id   INTEGER DEFAULT 0,
  ancestors   TEXT DEFAULT '',
  dept_name   TEXT DEFAULT '',
  order_num   INTEGER DEFAULT 0,
  leader      TEXT,
  phone       TEXT,
  email       TEXT,
  status      TEXT DEFAULT '0',
  del_flag    TEXT DEFAULT '0',
  create_by   TEXT DEFAULT '',
  create_time TEXT DEFAULT (datetime('now')),
  update_by   TEXT DEFAULT '',
  update_time TEXT DEFAULT (datetime('now'))
);

-- ── 2. 角色表 ──
CREATE TABLE IF NOT EXISTS sys_role (
  role_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role_name            TEXT NOT NULL,
  role_key             TEXT NOT NULL UNIQUE,
  role_sort            INTEGER NOT NULL,
  data_scope           TEXT DEFAULT '1',
  menu_check_strictly  INTEGER DEFAULT 1,
  dept_check_strictly  INTEGER DEFAULT 1,
  status               TEXT NOT NULL,
  del_flag             TEXT DEFAULT '0',
  create_by            TEXT DEFAULT '',
  create_time          TEXT DEFAULT (datetime('now')),
  update_by            TEXT DEFAULT '',
  update_time          TEXT DEFAULT (datetime('now')),
  remark               TEXT
);

-- ── 3. 菜单权限表 ──
CREATE TABLE IF NOT EXISTS sys_menu (
  menu_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_name   TEXT NOT NULL,
  parent_id   INTEGER DEFAULT 0,
  order_num   INTEGER DEFAULT 0,
  path        TEXT DEFAULT '',
  component   TEXT,
  query       TEXT,
  route_name  TEXT DEFAULT '',
  is_frame    INTEGER DEFAULT 1,
  is_cache    INTEGER DEFAULT 0,
  menu_type   TEXT DEFAULT '',
  visible     TEXT DEFAULT '0',
  status      TEXT DEFAULT '0',
  perms       TEXT,
  icon        TEXT DEFAULT '#',
  create_by   TEXT DEFAULT '',
  create_time TEXT DEFAULT (datetime('now')),
  update_by   TEXT DEFAULT '',
  update_time TEXT DEFAULT (datetime('now')),
  remark      TEXT DEFAULT ''
);

-- ── 4. 用户-角色关联表 ──
CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

-- ── 5. 角色-菜单关联表 ──
CREATE TABLE IF NOT EXISTS sys_role_menu (
  role_id INTEGER NOT NULL,
  menu_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, menu_id)
);

-- ── 6. 参数配置表 ──
CREATE TABLE IF NOT EXISTS sys_config (
  config_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  config_name  TEXT DEFAULT '',
  config_key   TEXT NOT NULL UNIQUE,
  config_value TEXT DEFAULT '',
  config_type  TEXT DEFAULT 'N',
  create_by    TEXT DEFAULT '',
  create_time  TEXT DEFAULT (datetime('now')),
  update_by    TEXT DEFAULT '',
  update_time  TEXT DEFAULT (datetime('now')),
  remark       TEXT
);

-- ── 7. 通知公告表 ──
CREATE TABLE IF NOT EXISTS sys_notice (
  notice_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  notice_title   TEXT NOT NULL,
  notice_type    TEXT NOT NULL,
  notice_content TEXT,
  status         TEXT DEFAULT '0',
  create_by      TEXT DEFAULT '',
  create_time    TEXT DEFAULT (datetime('now')),
  update_by      TEXT DEFAULT '',
  update_time    TEXT DEFAULT (datetime('now')),
  remark         TEXT
);

-- ── 8. 操作日志表（含登录日志） ──
CREATE TABLE IF NOT EXISTS sys_oper_log (
  oper_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT DEFAULT '',
  log_type        TEXT DEFAULT 'operation',
  business_type   INTEGER DEFAULT 0,
  method          TEXT DEFAULT '',
  request_method  TEXT DEFAULT '',
  oper_url        TEXT DEFAULT '',
  oper_ip         TEXT DEFAULT '',
  oper_location   TEXT DEFAULT '',
  oper_param      TEXT,
  json_result     TEXT,
  status          INTEGER DEFAULT 0,
  error_msg       TEXT DEFAULT '',
  oper_user_name  TEXT DEFAULT '',
  oper_time       TEXT DEFAULT (datetime('now')),
  cost_time       INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sys_oper_log_type ON sys_oper_log (log_type);
CREATE INDEX IF NOT EXISTS idx_sys_oper_log_time ON sys_oper_log (oper_time);

-- ============================================================
-- 初始数据
-- ============================================================

-- ── 默认部门 ──
INSERT OR IGNORE INTO sys_dept (dept_id, parent_id, ancestors, dept_name, order_num, status, del_flag, create_by, create_time)
VALUES (100, 0, '0', '默认部门', 0, '0', '0', 'admin', datetime('now'));

-- ── 默认角色 ──
INSERT OR IGNORE INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
VALUES (1, '超级管理员', 'admin', 1, '1', '0', '0', 'admin', datetime('now'), '超级管理员');

INSERT OR IGNORE INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
VALUES (2, '普通角色', 'common', 2, '2', '0', '0', 'admin', datetime('now'), '普通角色');

-- ── 菜单初始数据 ──
-- 一级目录：系统管理
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1, '系统管理', 0, 1, 'manager', NULL, '', '', 1, 0, 'M', '0', '0', '', 'system', 'admin', datetime('now'), '系统管理目录');

-- 二级菜单
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (100, '用户管理', 1, 1, 'user', 'manager/user/index', '', '', 1, 0, 'C', '0', '0', 'system:user:list', 'user', 'admin', datetime('now'), '用户管理菜单');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (101, '角色管理', 1, 2, 'role', 'manager/role/index', '', '', 1, 0, 'C', '0', '0', 'system:role:list', 'peoples', 'admin', datetime('now'), '角色管理菜单');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (102, '菜单管理', 1, 3, 'menu', 'manager/menu/index', '', '', 1, 0, 'C', '0', '0', 'system:menu:list', 'tree-table', 'admin', datetime('now'), '菜单管理菜单');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (103, '部门管理', 1, 4, 'dept', 'manager/dept/index', '', '', 1, 0, 'C', '0', '0', 'system:dept:list', 'tree', 'admin', datetime('now'), '部门管理菜单');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (106, '参数设置', 1, 7, 'config', 'manager/config/index', '', '', 1, 0, 'C', '0', '0', 'system:config:list', 'edit', 'admin', datetime('now'), '参数设置菜单');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (107, '通知公告', 1, 8, 'notice', 'manager/notice/index', '', '', 1, 0, 'C', '0', '0', 'system:notice:list', 'message', 'admin', datetime('now'), '通知公告菜单');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (108, '日志管理', 1, 9, 'log', '', '', '', 1, 0, 'M', '0', '0', '', 'log', 'admin', datetime('now'), '日志管理目录');

-- 三级菜单：操作日志
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (500, '操作日志', 108, 1, 'operlog', 'manager/operlog/index', '', '', 1, 0, 'C', '0', '0', 'system:operlog:list', 'form', 'admin', datetime('now'), '操作日志菜单');

-- ── 按钮权限 ──
-- 用户管理按钮
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1000, '用户查询', 100, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:query', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1001, '用户新增', 100, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:add', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1002, '用户修改', 100, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:edit', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1003, '用户删除', 100, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:remove', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1004, '用户导出', 100, 5, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:export', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1005, '用户导入', 100, 6, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:import', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1006, '重置密码', 100, 7, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:resetPwd', '#', 'admin', datetime('now'), '');

-- 角色管理按钮
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1007, '角色查询', 101, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:role:query', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1008, '角色新增', 101, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:role:add', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1009, '角色修改', 101, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:role:edit', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1010, '角色删除', 101, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:role:remove', '#', 'admin', datetime('now'), '');

-- 菜单管理按钮
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1012, '菜单查询', 102, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:menu:query', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1013, '菜单新增', 102, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:menu:add', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1014, '菜单修改', 102, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:menu:edit', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1015, '菜单删除', 102, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:menu:remove', '#', 'admin', datetime('now'), '');

-- 部门管理按钮
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1016, '部门查询', 103, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:dept:query', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1017, '部门新增', 103, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:dept:add', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1018, '部门修改', 103, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:dept:edit', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1019, '部门删除', 103, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:dept:remove', '#', 'admin', datetime('now'), '');

-- 参数设置按钮
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1024, '参数查询', 106, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:config:query', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1025, '参数新增', 106, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:config:add', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1026, '参数修改', 106, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:config:edit', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1027, '参数删除', 106, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:config:remove', '#', 'admin', datetime('now'), '');

-- 通知公告按钮
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1028, '公告查询', 107, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:notice:query', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1029, '公告新增', 107, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:notice:add', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1030, '公告修改', 107, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:notice:edit', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1031, '公告删除', 107, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:notice:remove', '#', 'admin', datetime('now'), '');

-- 操作日志按钮
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1032, '日志查询', 500, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:operlog:query', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1033, '日志删除', 500, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:operlog:remove', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (1034, '日志导出', 500, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:operlog:export', '#', 'admin', datetime('now'), '');

-- ── 默认参数配置 ──
INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (1, '主框架版本', 'sys.index.version', '0.1', 'Y', 'admin', datetime('now'), '版本号');

INSERT OR IGNORE INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark)
VALUES (2, '用户管理-账号初始密码', 'sys.user.initPassword', '123456', 'Y', 'admin', datetime('now'), '初始化密码 123456');
