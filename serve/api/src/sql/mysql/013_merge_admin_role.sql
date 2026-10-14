-- 013: 合并「超级管理员」(role_id=1, key=admin) 与「系统管理员」(role_id=3, key=sys_admin)
--      统一为「系统管理员」（等保要求不出现"超级管理员"名称），role_key=admin 保持不变。
-- 幂等：重复执行为空操作。

-- 1) 同时拥有双角色的用户先移除 role 3 绑定（避免重绑时唯一键冲突）
DELETE ur FROM sys_user_role ur
  JOIN sys_user_role ur1 ON ur1.user_id = ur.user_id AND ur1.role_id = 1
  WHERE ur.role_id = 3;

-- 2) 其余 role 3 用户重绑到 role 1（含 sysadmin 账号）
UPDATE sys_user_role SET role_id = 1 WHERE role_id = 3;

-- 3) 停用 sys_admin 角色（软删除，保留历史可追溯）
UPDATE sys_role SET del_flag = '2' WHERE role_id = 3;

-- 4) role 1 更名：等保要求不出现"超级管理员"
UPDATE sys_role SET role_name = '系统管理员' WHERE role_id = 1;
