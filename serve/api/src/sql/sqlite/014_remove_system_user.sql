-- 014: 移除 system 保留账号（物理删除）。
-- 背景：sys.online.maxUsers（合同授权同时在线人数上限）的管理主体由 system 账号
--       切换为 sysadmin 隐藏账号；system 不再承担任何职责，予以移除。
-- 历史数据：操作日志/审计数据中的 create_by 等为字符串字段，不依赖 sys_user 行存在，
--       物理删除不影响历史记录的可读性。
-- 幂等：重复执行为空操作。
DELETE FROM sys_user_role
  WHERE user_id IN (SELECT user_id FROM sys_user WHERE user_name = 'system');
DELETE FROM sys_user WHERE user_name = 'system';
