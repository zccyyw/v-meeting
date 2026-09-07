-- 011: 群组"常用/置顶"标记（需求 4：常用分组）
ALTER TABLE meeting_groups ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
