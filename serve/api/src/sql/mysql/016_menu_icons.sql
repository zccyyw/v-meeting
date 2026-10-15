-- 016: 菜单图标值规范化——存量若依 svg 名改写为 antd 图标组件全名，
--       供前端 IconSelect 图标选择控件与侧栏渲染消费；'#'（无图标）置空。
-- 幂等：重复执行结果不变。
UPDATE sys_menu SET icon = 'SettingOutlined'    WHERE icon = 'system';
UPDATE sys_menu SET icon = 'UserOutlined'       WHERE icon = 'user';
UPDATE sys_menu SET icon = 'TeamOutlined'       WHERE icon = 'peoples';
UPDATE sys_menu SET icon = 'FileTextOutlined'   WHERE icon = 'log';
UPDATE sys_menu SET icon = 'FormOutlined'       WHERE icon = 'form';
UPDATE sys_menu SET icon = ''                   WHERE icon = '#';
