-- 019: 主持人会议偏好——主持人工具开关的"下次开会保持"。
-- 主持人切换开关时 upsert 本表；该主持人新建会议的房间创建时按本表初始化默认值。
-- 锁定会议 / 隐藏会议号为临时性管控，不纳入持久化。
-- 幂等：重复执行为空操作。
CREATE TABLE IF NOT EXISTS host_meeting_prefs (
  user_id               BIGINT NOT NULL PRIMARY KEY,
  chat_allowed          SMALLINT NOT NULL DEFAULT 1,
  self_unmute_allowed   SMALLINT NOT NULL DEFAULT 1,
  raise_hand_allowed    SMALLINT NOT NULL DEFAULT 1,
  allow_share           SMALLINT NOT NULL DEFAULT 1,
  record_allowed        SMALLINT NOT NULL DEFAULT 0,
  waiting_room_enabled  SMALLINT NOT NULL DEFAULT 0,
  rotation_enabled      SMALLINT NOT NULL DEFAULT 1,
  rotation_interval_ms  INT NOT NULL DEFAULT 20000,
  side_list_visible     SMALLINT NOT NULL DEFAULT 1,
  layout_switch_allowed SMALLINT NOT NULL DEFAULT 1,
  danmu_enabled         SMALLINT NOT NULL DEFAULT 0,
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_host_meeting_prefs_user FOREIGN KEY (user_id) REFERENCES sys_user (user_id)
);
