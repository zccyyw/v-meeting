-- ============================================================
-- 006: 系统管理模块 — MySQL 版本
-- 注：users → sys_user 的重命名在 migrate.ts 中特殊处理
-- ============================================================

CREATE TABLE IF NOT EXISTS sys_dept (
  dept_id     BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  parent_id   BIGINT DEFAULT 0,
  ancestors   VARCHAR(50) DEFAULT '',
  dept_name   VARCHAR(30) DEFAULT '',
  order_num   INT DEFAULT 0,
  leader      VARCHAR(20),
  phone       VARCHAR(11),
  email       VARCHAR(50),
  status      CHAR(1) DEFAULT '0',
  del_flag    CHAR(1) DEFAULT '0',
  create_by   VARCHAR(64) DEFAULT '',
  create_time DATETIME,
  update_by   VARCHAR(64) DEFAULT '',
  update_time DATETIME
) ENGINE=InnoDB AUTO_INCREMENT=200 COMMENT='部门表';

CREATE TABLE IF NOT EXISTS sys_role (
  role_id              BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  role_name            VARCHAR(30) NOT NULL,
  role_key             VARCHAR(100) NOT NULL UNIQUE,
  role_sort            INT NOT NULL,
  data_scope           CHAR(1) DEFAULT '1',
  menu_check_strictly  TINYINT(1) DEFAULT 1,
  dept_check_strictly  TINYINT(1) DEFAULT 1,
  status               CHAR(1) NOT NULL,
  del_flag             CHAR(1) DEFAULT '0',
  create_by            VARCHAR(64) DEFAULT '',
  create_time          DATETIME,
  update_by            VARCHAR(64) DEFAULT '',
  update_time          DATETIME,
  remark               VARCHAR(500)
) ENGINE=InnoDB AUTO_INCREMENT=100 COMMENT='角色信息表';

CREATE TABLE IF NOT EXISTS sys_menu (
  menu_id     BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  menu_name   VARCHAR(50) NOT NULL,
  parent_id   BIGINT DEFAULT 0,
  order_num   INT DEFAULT 0,
  path        VARCHAR(200) DEFAULT '',
  component   VARCHAR(255),
  query       VARCHAR(255),
  route_name  VARCHAR(50) DEFAULT '',
  is_frame    INT DEFAULT 1,
  is_cache    INT DEFAULT 0,
  menu_type   CHAR(1) DEFAULT '',
  visible     CHAR(1) DEFAULT '0',
  status      CHAR(1) DEFAULT '0',
  perms       VARCHAR(100),
  icon        VARCHAR(100) DEFAULT '#',
  create_by   VARCHAR(64) DEFAULT '',
  create_time DATETIME,
  update_by   VARCHAR(64) DEFAULT '',
  update_time DATETIME,
  remark      VARCHAR(500) DEFAULT ''
) ENGINE=InnoDB AUTO_INCREMENT=2000 COMMENT='菜单权限表';

CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id)
) ENGINE=InnoDB COMMENT='用户和角色关联表';

CREATE TABLE IF NOT EXISTS sys_role_menu (
  role_id BIGINT NOT NULL,
  menu_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, menu_id)
) ENGINE=InnoDB COMMENT='角色和菜单关联表';

CREATE TABLE IF NOT EXISTS sys_config (
  config_id    BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  config_name  VARCHAR(100) DEFAULT '',
  config_key   VARCHAR(100) NOT NULL UNIQUE,
  config_value VARCHAR(500) DEFAULT '',
  config_type  CHAR(1) DEFAULT 'N',
  create_by    VARCHAR(64) DEFAULT '',
  create_time  DATETIME,
  update_by    VARCHAR(64) DEFAULT '',
  update_time  DATETIME,
  remark       VARCHAR(500)
) ENGINE=InnoDB COMMENT='参数配置表';

CREATE TABLE IF NOT EXISTS sys_notice (
  notice_id      BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  notice_title   VARCHAR(50) NOT NULL,
  notice_type    CHAR(1) NOT NULL,
  notice_content LONGBLOB,
  status         CHAR(1) DEFAULT '0',
  create_by      VARCHAR(64) DEFAULT '',
  create_time    DATETIME,
  update_by      VARCHAR(64) DEFAULT '',
  update_time    DATETIME,
  remark         VARCHAR(255)
) ENGINE=InnoDB COMMENT='通知公告表';

CREATE TABLE IF NOT EXISTS sys_oper_log (
  oper_id        BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(50) DEFAULT '',
  log_type        VARCHAR(20) DEFAULT 'operation',
  business_type   INT DEFAULT 0,
  method          VARCHAR(200) DEFAULT '',
  request_method  VARCHAR(10) DEFAULT '',
  oper_url        VARCHAR(255) DEFAULT '',
  oper_ip         VARCHAR(128) DEFAULT '',
  oper_location   VARCHAR(255) DEFAULT '',
  oper_param      VARCHAR(2000),
  json_result     VARCHAR(2000),
  status          INT DEFAULT 0,
  error_msg       VARCHAR(2000) DEFAULT '',
  oper_user_name  VARCHAR(50) DEFAULT '',
  oper_time       DATETIME,
  cost_time       BIGINT DEFAULT 0,
  INDEX idx_sys_oper_log_type (log_type),
  INDEX idx_sys_oper_log_time (oper_time)
) ENGINE=InnoDB COMMENT='操作日志记录表';

-- ============================================================
-- 初始数据
-- ============================================================

INSERT INTO sys_dept (dept_id, parent_id, ancestors, dept_name, order_num, status, del_flag, create_by, create_time)
SELECT 100, 0, '0', '默认部门', 0, '0', '0', 'admin', NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_dept WHERE dept_id = 100);

INSERT INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
SELECT 1, '超级管理员', 'admin', 1, '1', '0', '0', 'admin', NOW(), '超级管理员'
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE role_id = 1);

INSERT INTO sys_role (role_id, role_name, role_key, role_sort, data_scope, status, del_flag, create_by, create_time, remark)
SELECT 2, '普通角色', 'common', 2, '2', '0', '0', 'admin', NOW(), '普通角色'
WHERE NOT EXISTS (SELECT 1 FROM sys_role WHERE role_id = 2);

-- 菜单数据与 SQLite 版本完全一致（INSERT ... ON DUPLICATE KEY UPDATE 方式）
INSERT INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark) VALUES
(1, '系统管理', 0, 1, 'manager', NULL, '', '', 1, 0, 'M', '0', '0', '', 'system', 'admin', NOW(), '系统管理目录'),
(100, '用户管理', 1, 1, 'user', 'manager/user/index', '', '', 1, 0, 'C', '0', '0', 'system:user:list', 'user', 'admin', NOW(), '用户管理菜单'),
(101, '角色管理', 1, 2, 'role', 'manager/role/index', '', '', 1, 0, 'C', '0', '0', 'system:role:list', 'peoples', 'admin', NOW(), '角色管理菜单'),
(102, '菜单管理', 1, 3, 'menu', 'manager/menu/index', '', '', 1, 0, 'C', '0', '0', 'system:menu:list', 'tree-table', 'admin', NOW(), '菜单管理菜单'),
(103, '部门管理', 1, 4, 'dept', 'manager/dept/index', '', '', 1, 0, 'C', '0', '0', 'system:dept:list', 'tree', 'admin', NOW(), '部门管理菜单'),
(106, '参数设置', 1, 7, 'config', 'manager/config/index', '', '', 1, 0, 'C', '0', '0', 'system:config:list', 'edit', 'admin', NOW(), '参数设置菜单'),
(107, '通知公告', 1, 8, 'notice', 'manager/notice/index', '', '', 1, 0, 'C', '0', '0', 'system:notice:list', 'message', 'admin', NOW(), '通知公告菜单'),
(108, '日志管理', 1, 9, 'log', '', '', '', 1, 0, 'M', '0', '0', '', 'log', 'admin', NOW(), '日志管理目录'),
(500, '操作日志', 108, 1, 'operlog', 'manager/operlog/index', '', '', 1, 0, 'C', '0', '0', 'system:operlog:list', 'form', 'admin', NOW(), '操作日志菜单'),
(1000, '用户查询', 100, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:query', '#', 'admin', NOW(), ''),
(1001, '用户新增', 100, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:add', '#', 'admin', NOW(), ''),
(1002, '用户修改', 100, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:edit', '#', 'admin', NOW(), ''),
(1003, '用户删除', 100, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:remove', '#', 'admin', NOW(), ''),
(1004, '用户导出', 100, 5, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:export', '#', 'admin', NOW(), ''),
(1005, '用户导入', 100, 6, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:import', '#', 'admin', NOW(), ''),
(1006, '重置密码', 100, 7, '', '', '', '', 1, 0, 'F', '0', '0', 'system:user:resetPwd', '#', 'admin', NOW(), ''),
(1007, '角色查询', 101, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:role:query', '#', 'admin', NOW(), ''),
(1008, '角色新增', 101, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:role:add', '#', 'admin', NOW(), ''),
(1009, '角色修改', 101, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:role:edit', '#', 'admin', NOW(), ''),
(1010, '角色删除', 101, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:role:remove', '#', 'admin', NOW(), ''),
(1012, '菜单查询', 102, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:menu:query', '#', 'admin', NOW(), ''),
(1013, '菜单新增', 102, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:menu:add', '#', 'admin', NOW(), ''),
(1014, '菜单修改', 102, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:menu:edit', '#', 'admin', NOW(), ''),
(1015, '菜单删除', 102, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:menu:remove', '#', 'admin', NOW(), ''),
(1016, '部门查询', 103, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:dept:query', '#', 'admin', NOW(), ''),
(1017, '部门新增', 103, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:dept:add', '#', 'admin', NOW(), ''),
(1018, '部门修改', 103, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:dept:edit', '#', 'admin', NOW(), ''),
(1019, '部门删除', 103, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:dept:remove', '#', 'admin', NOW(), ''),
(1024, '参数查询', 106, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:config:query', '#', 'admin', NOW(), ''),
(1025, '参数新增', 106, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:config:add', '#', 'admin', NOW(), ''),
(1026, '参数修改', 106, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:config:edit', '#', 'admin', NOW(), ''),
(1027, '参数删除', 106, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:config:remove', '#', 'admin', NOW(), ''),
(1028, '公告查询', 107, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:notice:query', '#', 'admin', NOW(), ''),
(1029, '公告新增', 107, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:notice:add', '#', 'admin', NOW(), ''),
(1030, '公告修改', 107, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:notice:edit', '#', 'admin', NOW(), ''),
(1031, '公告删除', 107, 4, '', '', '', '', 1, 0, 'F', '0', '0', 'system:notice:remove', '#', 'admin', NOW(), ''),
(1032, '日志查询', 500, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:operlog:query', '#', 'admin', NOW(), ''),
(1033, '日志删除', 500, 2, '', '', '', '', 1, 0, 'F', '0', '0', 'system:operlog:remove', '#', 'admin', NOW(), ''),
(1034, '日志导出', 500, 3, '', '', '', '', 1, 0, 'F', '0', '0', 'system:operlog:export', '#', 'admin', NOW(), '')
ON DUPLICATE KEY UPDATE menu_id = menu_id;

INSERT INTO sys_config (config_id, config_name, config_key, config_value, config_type, create_by, create_time, remark) VALUES
(1, '主框架版本', 'sys.index.version', '0.1', 'Y', 'admin', NOW(), '版本号'),
(2, '用户管理-账号初始密码', 'sys.user.initPassword', '123456', 'Y', 'admin', NOW(), '初始化密码 123456')
ON DUPLICATE KEY UPDATE config_id = config_id;
