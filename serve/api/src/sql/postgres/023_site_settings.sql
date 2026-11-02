-- ============================================================
-- 023: 站点设置独立 KV 表（不复用 sys_config，便于后期扩展）
-- 兼容 PostgreSQL
-- ============================================================
CREATE TABLE IF NOT EXISTS sys_site_settings (
  site_id      BIGSERIAL PRIMARY KEY,
  site_name    VARCHAR(100) DEFAULT '',
  site_key     VARCHAR(100) NOT NULL UNIQUE,
  site_value   VARCHAR(500) DEFAULT '',
  site_type    CHAR(1) DEFAULT 'N',
  create_by    VARCHAR(64) DEFAULT '',
  create_time  TIMESTAMPTZ DEFAULT NOW(),
  update_by    VARCHAR(64) DEFAULT '',
  update_time  TIMESTAMPTZ DEFAULT NOW(),
  remark       VARCHAR(500)
);

-- 种子：幂等（ON CONFLICT DO NOTHING 仅跳过已存在的 key）。
INSERT INTO sys_site_settings (site_name, site_key, site_value, site_type, create_by, remark) VALUES
('项目名称',          'site.name',              'Meeting',  'Y', 'admin', '站点显示名称'),
('项目Logo',          'site.logo',              '/favicon.svg', 'Y', 'admin', 'Logo 图片地址'),
('版本标识',          'site.version',           '',         'Y', 'admin', '为空时前端用构建版本'),
('页脚版权',          'site.footer.copyright',  '',         'Y', 'admin', '页脚版权文本，留空不显示'),
('页脚显示版本',      'site.footer.showVersion','N',        'Y', 'admin', 'Y=显示版本'),
('页签显示名称',      'site.tab.showName',      'Y',        'Y', 'admin', 'Y=页签显示项目名'),
('页签标题',          'site.tab.title',         '',         'Y', 'admin', '留空取项目名称')
ON CONFLICT (site_key) DO NOTHING;
