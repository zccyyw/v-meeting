-- ============================================================
-- Meeting 数据库最新完整表结构 — MySQL 8
-- 生成方式：合并 serve/api/src/sql/mysql/ 下全部迁移的建表语句，
--           并应用后续 ALTER TABLE ADD COLUMN（等价于迁移执行后的最终态）
-- 用途：全新环境初始化 / 结构查阅；生产升级请依赖服务启动时的自动迁移
-- 表：17；索引：11
-- ============================================================

-- ---------- 表 ----------
-- 业务用户自 v0.0.7 起使用 sys_user（users 仅为旧版迁移兼容保留的空表）。
-- 因此 meetings / meeting_join_tokens / recordings 的用户外键指向 sys_user(user_id)，
-- 与 serve/sql/meeting-sqlite.sql 保持一致；否则 sys_user 用户创建会议 / 令牌 / 录制
-- 会因 FK 指向空表 users 而报 ER_NO_REFERENCED_ROW_2 (500)。
-- sys_user 定义在文件后部，故建表阶段临时关闭外键检查（标准 dump 做法）。
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  phone VARCHAR(32) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS meetings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  title VARCHAR(120) NOT NULL,
  host_user_id BIGINT UNSIGNED NULL,
  status VARCHAR(16) NOT NULL,
  waiting_room_enabled TINYINT(1) NOT NULL DEFAULT 0,
  join_password_hash VARCHAR(100) NULL,
  scheduled_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  record_allowed TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uk_meetings_code (code),
  KEY idx_meetings_host (host_user_id),
  CONSTRAINT fk_meetings_host FOREIGN KEY (host_user_id) REFERENCES sys_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS meeting_join_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  token CHAR(64) NOT NULL,
  meeting_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  role VARCHAR(16) NOT NULL,
  display_name VARCHAR(64) NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_tokens_token (token),
  KEY idx_tokens_meeting (meeting_id),
  CONSTRAINT fk_tokens_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id),
  CONSTRAINT fk_tokens_user FOREIGN KEY (user_id) REFERENCES sys_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recordings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id BIGINT UNSIGNED NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  duration_ms INT NOT NULL DEFAULT 0,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'client',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_recordings_meeting FOREIGN KEY (meeting_id) REFERENCES meetings (id) ON DELETE SET NULL,
  CONSTRAINT fk_recordings_owner FOREIGN KEY (owner_user_id) REFERENCES sys_user (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

-- 系统用户表（由迁移 migrateSysUser 从 users 表演化而来，此处为最终结构）
CREATE TABLE IF NOT EXISTS sys_user (
  user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_name VARCHAR(64) NOT NULL,
  password VARCHAR(100) NOT NULL,
  nick_name VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  dept_id BIGINT NULL,
  user_type VARCHAR(2) DEFAULT '00',
  email VARCHAR(50) DEFAULT '',
  sex CHAR(1) DEFAULT '0',
  avatar VARCHAR(100) DEFAULT '',
  del_flag CHAR(1) DEFAULT '0',
  login_ip VARCHAR(128) DEFAULT '',
  login_date DATETIME NULL,
  pwd_update_date DATETIME NULL,
  create_by VARCHAR(64) DEFAULT '',
  update_by VARCHAR(64) DEFAULT '',
  remark VARCHAR(500) NULL,
  create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_sys_user_user_name (user_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  INDEX idx_sys_oper_log_time (oper_time),
  oper_object VARCHAR(200) DEFAULT '',
  classification VARCHAR(20) DEFAULT '公开'
) ENGINE=InnoDB COMMENT='操作日志记录表';

CREATE TABLE IF NOT EXISTS meeting_invitations (
  id           BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  meeting_id   BIGINT NOT NULL,
  user_id      BIGINT,
  dept_id      BIGINT,
  display_name VARCHAR(100),
  status       VARCHAR(20) DEFAULT 'pending',
  invited_at   DATETIME DEFAULT NOW(),
  joined_at    DATETIME,
  UNIQUE INDEX uk_meeting_user (meeting_id, user_id),
) ENGINE=InnoDB COMMENT='会议邀请名单';

CREATE TABLE IF NOT EXISTS meeting_groups (
  group_id   BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_name VARCHAR(50) NOT NULL,
  owner_id   BIGINT NOT NULL,
  created_at DATETIME DEFAULT NOW(),
  pinned TINYINT(1) NOT NULL DEFAULT 0,
) ENGINE=InnoDB COMMENT='常用群组';

CREATE TABLE IF NOT EXISTS meeting_group_members (
  id       BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id  BIGINT,
  dept_id  BIGINT
) ENGINE=InnoDB COMMENT='群组成员';

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

CREATE TABLE IF NOT EXISTS meeting_applications (
  app_id        BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  applicant_id  BIGINT NOT NULL,
  meeting_time  DATETIME NOT NULL,
  end_time      DATETIME,
  location      VARCHAR(255),
  dept_count    INT DEFAULT 0,
  priority      VARCHAR(10) DEFAULT '中',
  status        VARCHAR(20) DEFAULT 'pending',
  approver_id   BIGINT,
  approve_time  DATETIME,
  meeting_id    BIGINT,
  created_at    DATETIME DEFAULT NOW(),
  remark        VARCHAR(500)
) ENGINE=InnoDB COMMENT='会议申请审批表';

-- ---------- 索引 ----------
CREATE INDEX idx_meeting_invitations_meeting ON meeting_invitations(meeting_id);

CREATE INDEX idx_meeting_invitations_user ON meeting_invitations(user_id);

CREATE INDEX idx_meeting_groups_owner ON meeting_groups(owner_id);

CREATE INDEX idx_meeting_group_members_group ON meeting_group_members(group_id);

CREATE INDEX idx_meeting_group_members_user ON meeting_group_members(user_id);

CREATE INDEX idx_meeting_group_members_dept ON meeting_group_members(dept_id);

CREATE INDEX idx_sys_user_approval_status ON sys_user_approval (status);

CREATE INDEX idx_sys_user_approval_requester ON sys_user_approval (requester_id);

CREATE INDEX idx_meeting_applications_status ON meeting_applications (status);

CREATE INDEX idx_meeting_applications_applicant ON meeting_applications (applicant_id);

CREATE INDEX idx_meeting_applications_priority ON meeting_applications (priority);

SET FOREIGN_KEY_CHECKS = 1;
