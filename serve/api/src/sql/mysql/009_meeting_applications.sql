-- ============================================================
-- 009: 会议申请审批表
-- 兼容 MySQL
-- ============================================================

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

CREATE INDEX idx_meeting_applications_status ON meeting_applications (status);
CREATE INDEX idx_meeting_applications_applicant ON meeting_applications (applicant_id);
CREATE INDEX idx_meeting_applications_priority ON meeting_applications (priority);
