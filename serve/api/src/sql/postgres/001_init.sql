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
  host_user_id BIGINT NULL REFERENCES users (id),
  status VARCHAR(16) NOT NULL,
  waiting_room_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  join_password_hash VARCHAR(100) NULL,
  scheduled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ NULL,
  CONSTRAINT uk_meetings_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_meetings_host ON meetings (host_user_id);

CREATE TABLE IF NOT EXISTS meeting_join_tokens (
  id BIGSERIAL PRIMARY KEY,
  token CHAR(64) NOT NULL,
  meeting_id BIGINT NOT NULL REFERENCES meetings (id),
  user_id BIGINT NULL REFERENCES users (id),
  role VARCHAR(16) NOT NULL,
  display_name VARCHAR(64) NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_tokens_token UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_tokens_meeting ON meeting_join_tokens (meeting_id);
