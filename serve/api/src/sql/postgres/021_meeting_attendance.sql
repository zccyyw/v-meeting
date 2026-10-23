-- 021: 实际参会记录（说明同 mysql 版）。
CREATE TABLE IF NOT EXISTS meeting_attendance (
  id           BIGSERIAL PRIMARY KEY,
  meeting_id   BIGINT NOT NULL,
  user_id      BIGINT NULL,
  display_name VARCHAR(100) NOT NULL,
  is_guest     BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uk_meeting_attendance UNIQUE (meeting_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_meeting_attendance_meeting ON meeting_attendance(meeting_id);
