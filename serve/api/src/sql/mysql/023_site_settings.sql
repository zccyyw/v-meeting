-- ============================================================
-- 023: 站点设置独立 KV 表（不复用 sys_config，便于后期扩展）
-- 兼容 MySQL
-- ============================================================
CREATE TABLE IF NOT EXISTS sys_site_settings (
  site_id      BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  site_name    VARCHAR(100) DEFAULT '',
  site_key     VARCHAR(100) NOT NULL UNIQUE,
  site_value   VARCHAR(500) DEFAULT '',
  site_type    CHAR(1) DEFAULT 'N',
  create_by    VARCHAR(64) DEFAULT '',
  create_time  DATETIME,
  update_by    VARCHAR(64) DEFAULT '',
  update_time  DATETIME,
  remark       VARCHAR(500)
) ENGINE=InnoDB COMMENT='站点设置表';

-- 种子：幂等（重复执行仅跳过）。site_type='Y' 标记内置项。
INSERT INTO sys_site_settings (site_name, site_key, site_value, site_type, create_by, create_time, remark) VALUES
('项目名称',          'site.name',              'Meeting',  'Y', 'admin', NOW(), '站点显示名称'),
('项目Logo',          'site.logo',              '/favicon.svg', 'Y', 'admin', NOW(), 'Logo 图片地址'),
('版本标识',          'site.version',           '',         'Y', 'admin', NOW(), '为空时前端用构建版本'),
('页脚版权',          'site.footer.copyright',  '',         'Y', 'admin', NOW(), '页脚版权文本，留空不显示'),
('页脚显示版本',      'site.footer.showVersion','N',        'Y', 'admin', NOW(), 'Y=显示版本'),
('页签显示名称',      'site.tab.showName',      'Y',        'Y', 'admin', NOW(), 'Y=页签显示项目名'),
('页签标题',          'site.tab.title',         '',         'Y', 'admin', NOW(), '留空取项目名称')
ON DUPLICATE KEY UPDATE site_key = site_key;
