-- ============================================================
-- Meeting 数据库最新完整表结构 — PostgreSQL 12+
-- 生成方式：合并 serve/api/src/sql/postgres/ 下全部迁移的建表语句，
--           并应用后续 ALTER TABLE ADD COLUMN（等价于迁移执行后的最终态）
-- 用途：全新环境初始化 / 结构查阅；生产升级请依赖服务启动时的自动迁移
-- 表：17；索引：18
-- ============================================================

-- ---------- 表 ----------
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(64) NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  phone VARCHAR(32) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_users_username UNIQUE (username)
);

CREATE TABLE IF NOT EXISTS meetings (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(16) NOT NULL,
  title VARCHAR(120) NOT NULL,
  -- 用户外键统一在文件尾部添加（指向 sys_user.user_id）：业务用户自 v0.0.7 起
  -- 使用 sys_user（users 仅为旧版迁移兼容保留的空表），且 sys_user 建表在后。
  host_user_id BIGINT NULL,
  status VARCHAR(16) NOT NULL,
  waiting_room_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  join_password_hash VARCHAR(100) NULL,
  scheduled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ NULL,
  CONSTRAINT uk_meetings_code UNIQUE (code),
  record_allowed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS meeting_join_tokens (
  id BIGSERIAL PRIMARY KEY,
  token CHAR(64) NOT NULL,
  meeting_id BIGINT NOT NULL REFERENCES meetings (id),
  user_id BIGINT NULL,
  role VARCHAR(16) NOT NULL,
  display_name VARCHAR(64) NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_tokens_token UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS recordings (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NULL REFERENCES meetings (id) ON DELETE SET NULL,
  owner_user_id BIGINT NOT NULL,
  title VARCHAR(200) NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'client',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_dept (
  dept_id     BIGSERIAL PRIMARY KEY,
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
  create_time TIMESTAMPTZ DEFAULT NOW(),
  update_by   VARCHAR(64) DEFAULT '',
  update_time TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sys_role (
  role_id              BIGSERIAL PRIMARY KEY,
  role_name            VARCHAR(30) NOT NULL,
  role_key             VARCHAR(100) NOT NULL UNIQUE,
  role_sort            INT NOT NULL,
  data_scope           CHAR(1) DEFAULT '1',
  menu_check_strictly  INT DEFAULT 1,
  dept_check_strictly  INT DEFAULT 1,
  status               CHAR(1) NOT NULL,
  del_flag             CHAR(1) DEFAULT '0',
  create_by            VARCHAR(64) DEFAULT '',
  create_time          TIMESTAMPTZ DEFAULT NOW(),
  update_by            VARCHAR(64) DEFAULT '',
  update_time          TIMESTAMPTZ DEFAULT NOW(),
  remark               VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS sys_menu (
  menu_id     BIGSERIAL PRIMARY KEY,
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
  create_time TIMESTAMPTZ DEFAULT NOW(),
  update_by   VARCHAR(64) DEFAULT '',
  update_time TIMESTAMPTZ DEFAULT NOW(),
  remark      VARCHAR(500) DEFAULT ''
);

-- 系统用户表（由迁移 migrateSysUser 从 users 表演化而来，此处为最终结构）
CREATE TABLE IF NOT EXISTS sys_user (
  user_id BIGSERIAL PRIMARY KEY,
  user_name VARCHAR(64) NOT NULL,
  password VARCHAR(100) NOT NULL,
  nick_name VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  dept_id BIGINT,
  user_type VARCHAR(2) DEFAULT '00',
  email VARCHAR(50) DEFAULT '',
  sex CHAR(1) DEFAULT '0',
  avatar VARCHAR(100) DEFAULT '',
  del_flag CHAR(1) DEFAULT '0',
  login_ip VARCHAR(128) DEFAULT '',
  login_date TIMESTAMPTZ,
  pwd_update_date TIMESTAMPTZ,
  create_by VARCHAR(64) DEFAULT '',
  update_by VARCHAR(64) DEFAULT '',
  remark VARCHAR(500),
  create_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  update_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_name)
);

CREATE TABLE IF NOT EXISTS sys_user_role (
  user_id BIGINT NOT NULL,
  role_id BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS sys_role_menu (
  role_id BIGINT NOT NULL,
  menu_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, menu_id)
);

CREATE TABLE IF NOT EXISTS sys_config (
  config_id    BIGSERIAL PRIMARY KEY,
  config_name  VARCHAR(100) DEFAULT '',
  config_key   VARCHAR(100) NOT NULL UNIQUE,
  config_value VARCHAR(500) DEFAULT '',
  config_type  CHAR(1) DEFAULT 'N',
  create_by    VARCHAR(64) DEFAULT '',
  create_time  TIMESTAMPTZ DEFAULT NOW(),
  update_by    VARCHAR(64) DEFAULT '',
  update_time  TIMESTAMPTZ DEFAULT NOW(),
  remark       VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS sys_notice (
  notice_id      BIGSERIAL PRIMARY KEY,
  notice_title   VARCHAR(50) NOT NULL,
  notice_type    CHAR(1) NOT NULL,
  notice_content TEXT,
  status         CHAR(1) DEFAULT '0',
  create_by      VARCHAR(64) DEFAULT '',
  create_time    TIMESTAMPTZ DEFAULT NOW(),
  update_by      VARCHAR(64) DEFAULT '',
  update_time    TIMESTAMPTZ DEFAULT NOW(),
  remark         VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS sys_oper_log (
  oper_id        BIGSERIAL PRIMARY KEY,
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
  oper_time       TIMESTAMPTZ DEFAULT NOW(),
  cost_time       BIGINT DEFAULT 0
  oper_object VARCHAR(200) DEFAULT '',
  classification VARCHAR(20) DEFAULT '公开',
);

CREATE TABLE IF NOT EXISTS meeting_invitations (
  id           BIGSERIAL PRIMARY KEY,
  meeting_id   BIGINT NOT NULL,
  user_id      BIGINT,
  dept_id      BIGINT,
  display_name VARCHAR(100),
  status       VARCHAR(20) DEFAULT 'pending',
  invited_at   TIMESTAMPTZ DEFAULT NOW(),
  joined_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS meeting_groups (
  group_id   BIGSERIAL PRIMARY KEY,
  group_name VARCHAR(50) NOT NULL,
  owner_id   BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
);

CREATE TABLE IF NOT EXISTS meeting_group_members (
  id       BIGSERIAL PRIMARY KEY,
  group_id BIGINT NOT NULL,
  user_id  BIGINT,
  dept_id  BIGINT
);

CREATE TABLE IF NOT EXISTS sys_user_approval (
  approval_id    BIGSERIAL PRIMARY KEY,
  request_type   VARCHAR(20) NOT NULL,
  target_user_id BIGINT,
  requester_id   BIGINT NOT NULL,
  requester_data TEXT,
  status         VARCHAR(20) DEFAULT 'pending',
  approver_id    BIGINT,
  approve_time   TIMESTAMPTZ,
  reject_reason  VARCHAR(500),
  create_time    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meeting_applications (
  app_id        BIGSERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  applicant_id  BIGINT NOT NULL,
  meeting_time  TIMESTAMPTZ NOT NULL,
  end_time      TIMESTAMPTZ,
  location      VARCHAR(255),
  dept_count    INT DEFAULT 0,
  priority      VARCHAR(10) DEFAULT '中',
  status        VARCHAR(20) DEFAULT 'pending',
  approver_id   BIGINT,
  approve_time  TIMESTAMPTZ,
  meeting_id    BIGINT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  remark        VARCHAR(500)
);

-- ---------- 索引 ----------
CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings (host_user_id);

CREATE INDEX IF NOT EXISTS idx_tokens_meeting ON meeting_join_tokens (meeting_id);

CREATE INDEX IF NOT EXISTS idx_recordings_owner ON recordings (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings (meeting_id);

CREATE INDEX IF NOT EXISTS idx_sys_oper_log_type ON sys_oper_log (log_type);

CREATE INDEX IF NOT EXISTS idx_sys_oper_log_time ON sys_oper_log (oper_time);

CREATE INDEX IF NOT EXISTS idx_meeting_invitations_meeting ON meeting_invitations(meeting_id);

CREATE INDEX IF NOT EXISTS idx_meeting_invitations_user ON meeting_invitations(user_id);

CREATE INDEX IF NOT EXISTS idx_meeting_groups_owner ON meeting_groups(owner_id);

CREATE INDEX IF NOT EXISTS idx_meeting_group_members_group ON meeting_group_members(group_id);

CREATE INDEX IF NOT EXISTS idx_meeting_group_members_user ON meeting_group_members(user_id);

CREATE INDEX IF NOT EXISTS idx_meeting_group_members_dept ON meeting_group_members(dept_id);

CREATE INDEX IF NOT EXISTS idx_sys_user_approval_status ON sys_user_approval (status);

CREATE INDEX IF NOT EXISTS idx_sys_user_approval_requester ON sys_user_approval (requester_id);

CREATE INDEX IF NOT EXISTS idx_meeting_applications_status ON meeting_applications (status);

CREATE INDEX IF NOT EXISTS idx_meeting_applications_applicant ON meeting_applications (applicant_id);

CREATE INDEX IF NOT EXISTS idx_meeting_applications_priority ON meeting_applications (priority);

CREATE UNIQUE INDEX IF NOT EXISTS uk_meeting_invitations_meeting_user ON meeting_invitations(meeting_id, user_id);

-- ---------- 用户外键（sys_user 建表完成后统一添加） ----------
-- 指向 sys_user(user_id)，与 meeting-sqlite.sql 一致；DO 块保证幂等。
DO $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_meetings_host' AND conrelid = 'meetings'::regclass
  ) THEN
    ALTER TABLE meetings ADD CONSTRAINT fk_meetings_host
      FOREIGN KEY (host_user_id) REFERENCES sys_user (user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_tokens_user' AND conrelid = 'meeting_join_tokens'::regclass
  ) THEN
    ALTER TABLE meeting_join_tokens ADD CONSTRAINT fk_tokens_user
      FOREIGN KEY (user_id) REFERENCES sys_user (user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_recordings_owner' AND conrelid = 'recordings'::regclass
  ) THEN
    ALTER TABLE recordings ADD CONSTRAINT fk_recordings_owner
      FOREIGN KEY (owner_user_id) REFERENCES sys_user (user_id) ON DELETE CASCADE;
  END IF;
END
$fn$;
