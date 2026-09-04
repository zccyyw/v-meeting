CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id INTEGER NULL REFERENCES meetings (id) ON DELETE SET NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'client',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recordings_owner ON recordings (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_recordings_meeting ON recordings (meeting_id);
