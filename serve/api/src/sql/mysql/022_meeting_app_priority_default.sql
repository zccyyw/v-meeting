-- ============================================================
-- 022: 会议申请优先级默认值机器码化
-- 兼容 MySQL
-- ============================================================
-- 009 建表时 priority 默认值为中文 '中'，与后端枚举（high/medium/low）不一致：
-- 任何省略 priority 的写入（手工 SQL、老客户端）都会落 '中'，进而在
-- 按优先级排序的 SQL 里落到 ELSE 分支。
-- 注：本文件只改列默认值（新库由 009 直接生效）；存量行的中文值由
-- migrate.ts 的 migrateMeetingAppPriority 在迁移末尾统一回填。

ALTER TABLE meeting_applications ALTER COLUMN priority SET DEFAULT 'medium';
