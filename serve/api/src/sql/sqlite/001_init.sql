CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  host_user_id INTEGER NULL REFERENCES users (id),
  status TEXT NOT NULL,
  waiting_room_enabled INTEGER NOT NULL DEFAULT 0,
  join_password_hash TEXT,
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings (host_user_id);

CREATE TABLE IF NOT EXISTS meeting_join_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  meeting_id INTEGER NOT NULL REFERENCES meetings (id),
  user_id INTEGER NULL REFERENCES users (id),
  role TEXT NOT NULL,
  display_name TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_tokens_meeting ON meeting_join_tokens (meeting_id);
