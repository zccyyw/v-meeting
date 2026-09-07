-- 011: 群组"常用/置顶"标记（需求 4：常用分组）
ALTER TABLE meeting_groups ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
