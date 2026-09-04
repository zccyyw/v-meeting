CREATE TABLE IF NOT EXISTS recordings (
  id BIGSERIAL PRIMARY KEY,
  meeting_id BIGINT NULL REFERENCES meetings (id) ON DELETE SET NULL,
  owner_user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'client',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recordings_owner ON recordings (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings (meeting_id);
