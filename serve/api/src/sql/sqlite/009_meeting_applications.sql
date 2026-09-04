-- ============================================================
-- 009: 会议申请审批表
-- 兼容 SQLite
-- ============================================================

CREATE TABLE IF NOT EXISTS meeting_applications (
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

CREATE INDEX IF NOT EXISTS idx_meeting_applications_status ON meeting_applications (status);
CREATE INDEX IF NOT EXISTS idx_meeting_applications_applicant ON meeting_applications (applicant_id);
CREATE INDEX IF NOT EXISTS idx_meeting_applications_priority ON meeting_applications (priority);
