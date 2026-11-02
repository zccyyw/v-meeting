-- ============================================================
-- 024: 站点设置菜单 + 权限（system:site:edit）
-- 兼容 SQLite。menu_id 取 900/901，避开其它模块已占用的段。
-- ============================================================
INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (900, '站点设置', 1, 9, 'site-settings', 'manager/site-settings/index', '', '', 1, 0, 'C', '0', '0', 'system:site:edit', 'setting', 'admin', datetime('now'), '站点名称/Logo/版本/页脚/页签配置');

INSERT OR IGNORE INTO sys_menu (menu_id, menu_name, parent_id, order_num, path, component, query, route_name, is_frame, is_cache, menu_type, visible, status, perms, icon, create_by, create_time, remark)
VALUES (901, '站点设置修改', 900, 1, '', '', '', '', 1, 0, 'F', '0', '0', 'system:site:edit', '#', 'admin', datetime('now'), '');

INSERT OR IGNORE INTO sys_role_menu (role_id, menu_id) VALUES (1, 900);
