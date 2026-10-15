-- 015: 管理端侧栏菜单动态化——补充业务管理菜单并预授权三员角色。
-- 层级（根目录「系统管理」menu_id=1 不作为侧栏一级展示，navs 由其子级构成）：
--   审批管理 (200, M) ─ 会议审批 (201, C) / 用户审批 (202, C)
--   会议监控 (300, C, 一级直挂)
-- 预授权：授权管理员(4) → 200/201/202/300；审计管理员(5) → 200/300。
-- admin 分支查全表无需预授权。幂等：重复执行为空操作。
INSERT INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, menu_type, visible, status, perms)
VALUES (200, '审批管理', 1, 7, 'approval', 'M', '0', '0', '')
ON CONFLICT (menu_id) DO NOTHING;
INSERT INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, menu_type, visible, status, perms)
VALUES (201, '会议审批', 200, 1, 'meeting-approval', 'C', '0', '0', 'meeting:approval:list')
ON CONFLICT (menu_id) DO NOTHING;
INSERT INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, menu_type, visible, status, perms)
VALUES (202, '用户审批', 200, 2, 'user-approval', 'C', '0', '0', 'system:user-approval:list')
ON CONFLICT (menu_id) DO NOTHING;
INSERT INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, menu_type, visible, status, perms)
VALUES (300, '会议监控', 1, 8, 'meeting-monitor', 'C', '0', '0', 'meeting:monitor:list')
ON CONFLICT (menu_id) DO NOTHING;

INSERT INTO sys_role_menu (role_id, menu_id) VALUES (4, 200) ON CONFLICT DO NOTHING;
INSERT INTO sys_role_menu (role_id, menu_id) VALUES (4, 201) ON CONFLICT DO NOTHING;
INSERT INTO sys_role_menu (role_id, menu_id) VALUES (4, 202) ON CONFLICT DO NOTHING;
INSERT INTO sys_role_menu (role_id, menu_id) VALUES (4, 300) ON CONFLICT DO NOTHING;
INSERT INTO sys_role_menu (role_id, menu_id) VALUES (5, 200) ON CONFLICT DO NOTHING;
INSERT INTO sys_role_menu (role_id, menu_id) VALUES (5, 300) ON CONFLICT DO NOTHING;
