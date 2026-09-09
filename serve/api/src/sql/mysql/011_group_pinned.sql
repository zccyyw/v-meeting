-- 011: 群组"常用/置顶"标记（需求 4：常用分组）
-- MySQL 不支持 ADD COLUMN IF NOT EXISTS，用 information_schema 判断后动态执行，
-- 保证重复启动时幂等（避免 ER_DUP_FIELDNAME 中断服务启动）。
SET @exist_pinned := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'meeting_groups'
    AND COLUMN_NAME = 'pinned'
);
SET @sql_pinned := IF(
  @exist_pinned = 0,
  'ALTER TABLE meeting_groups ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt_pinned FROM @sql_pinned;
EXECUTE stmt_pinned;
DEALLOCATE PREPARE stmt_pinned;
