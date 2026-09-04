-- ============================================================
-- 009: 会议申请审批表
-- 兼容 PostgreSQL
-- ============================================================

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

CREATE INDEX IF NOT EXISTS idx_meeting_applications_status ON meeting_applications (status);
CREATE INDEX IF NOT EXISTS idx_meeting_applications_applicant ON meeting_applications (applicant_id);
CREATE INDEX IF NOT EXISTS idx_meeting_applications_priority ON meeting_applications (priority);
