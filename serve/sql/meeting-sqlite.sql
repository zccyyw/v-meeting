-- ============================================================
-- Meeting 数据库最新完整表结构 — SQLITE
-- 生成方式：执行 serve/api/src/sql/sqlite/ 下全部迁移后从数据库导出（权威）
-- 用途：全新环境初始化 / 结构查阅；生产升级请使用迁移（服务启动时自动执行）
-- 表：18；索引：18；触发器：2
-- ============================================================

-- ---------- 表 ----------
CREATE TABLE meeting_applications (
  app_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  applicant_id  INTEGER NOT NULL,
  meeting_time  TEXT NOT NULL,
  end_time      TEXT,
  location      TEXT,
  dept_count    INTEGER DEFAULT 0,
  priority      TEXT DEFAULT '中',
  status        TEXT DEFAULT 'pending',
  approver_id   INTEGER,
  approve_time  TEXT,
  meeting_id    INTEGER,
  created_at    TEXT DEFAULT (datetime('now')),
  remark        TEXT
);

CREATE TABLE meeting_group_members (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_id  INTEGER,
  dept_id  INTEGER
);

CREATE TABLE meeting_groups (
  group_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name TEXT NOT NULL,
  owner_id   INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
, pinned INTEGER NOT NULL DEFAULT 0);

CREATE TABLE meeting_invitations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id   INTEGER NOT NULL,
  user_id      INTEGER,
  dept_id      INTEGER,
  display_name TEXT,
  status       TEXT DEFAULT 'pending',
  invited_at   TEXT DEFAULT (datetime('now')),
  joined_at    TEXT
);

CREATE TABLE meeting_join_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  meeting_id INTEGER NOT NULL REFERENCES meetings (id),
  user_id INTEGER NULL REFERENCES "sys_user" (user_id),
  role TEXT NOT NULL,
  display_name TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (token)
);

CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  host_user_id INTEGER NULL REFERENCES "sys_user" (user_id),
  status TEXT NOT NULL,
  waiting_room_enabled INTEGER NOT NULL DEFAULT 0,
  join_password_hash TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT, record_allowed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (code)
);

CREATE TABLE recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NULL REFERENCES meetings (id) ON DELETE SET NULL,
  owner_user_id INTEGER NOT NULL REFERENCES "sys_user" (user_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'client',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sys_config (
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

CREATE TABLE sys_dept (
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

CREATE TABLE sys_menu (
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

CREATE TABLE sys_notice (
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

CREATE TABLE sys_oper_log (
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
, oper_object TEXT, classification TEXT DEFAULT '公开');

CREATE TABLE sys_role (
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

CREATE TABLE sys_role_menu (
  role_id INTEGER NOT NULL,
  menu_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, menu_id)
);

CREATE TABLE "sys_user" (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_name TEXT NOT NULL,
  password TEXT NOT NULL,
  nick_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  phonenumber TEXT,
  create_time TEXT NOT NULL DEFAULT (datetime('now')),
  update_time TEXT NOT NULL DEFAULT (datetime('now')), dept_id INTEGER, user_type TEXT DEFAULT '00', email TEXT DEFAULT '', sex TEXT DEFAULT '0', avatar TEXT DEFAULT '', del_flag TEXT DEFAULT '0', login_ip TEXT DEFAULT '', login_date TEXT, pwd_update_date TEXT, create_by TEXT DEFAULT '', update_by TEXT DEFAULT '', remark TEXT,
  UNIQUE (user_name)
);

CREATE TABLE sys_user_approval (
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

CREATE TABLE sys_user_role (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (username)
);

-- ---------- 索引 ----------
CREATE INDEX idx_meeting_applications_applicant ON meeting_applications (applicant_id);

CREATE INDEX idx_meeting_applications_priority ON meeting_applications (priority);

CREATE INDEX idx_meeting_applications_status ON meeting_applications (status);

CREATE INDEX idx_meeting_group_members_dept ON meeting_group_members(dept_id);

CREATE INDEX idx_meeting_group_members_group ON meeting_group_members(group_id);

CREATE INDEX idx_meeting_group_members_user ON meeting_group_members(user_id);

CREATE INDEX idx_meeting_groups_owner ON meeting_groups(owner_id);

CREATE INDEX idx_meeting_invitations_meeting ON meeting_invitations(meeting_id);

CREATE INDEX idx_meeting_invitations_user ON meeting_invitations(user_id);

CREATE INDEX idx_meetings_host ON meetings (host_user_id);

CREATE INDEX idx_recordings_meeting ON recordings (meeting_id);

CREATE INDEX idx_recordings_owner ON recordings (owner_user_id);

CREATE INDEX idx_sys_oper_log_time ON sys_oper_log (oper_time);

CREATE INDEX idx_sys_oper_log_type ON sys_oper_log (log_type);

CREATE INDEX idx_sys_user_approval_requester ON sys_user_approval (requester_id);

CREATE INDEX idx_sys_user_approval_status ON sys_user_approval (status);

CREATE INDEX idx_tokens_meeting ON meeting_join_tokens (meeting_id);

CREATE UNIQUE INDEX uk_meeting_invitations_meeting_user ON meeting_invitations(meeting_id, user_id);

-- ---------- 触发器 ----------
CREATE TRIGGER trg_sys_user_update_time
          AFTER UPDATE ON sys_user
          FOR EACH ROW
          WHEN (NEW.update_time = OLD.update_time OR NEW.update_time IS OLD.update_time)
          BEGIN
            UPDATE sys_user SET update_time = datetime('now') WHERE user_id = NEW.user_id;
          END;

CREATE TRIGGER trg_users_updated_at
      AFTER UPDATE ON users
      FOR EACH ROW
      WHEN (NEW.updated_at = OLD.updated_at OR NEW.updated_at IS OLD.updated_at)
      BEGIN
        UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id;
      END;
