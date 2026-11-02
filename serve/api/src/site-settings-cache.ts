import type { Db } from "./db.js";

/** 站点设置（前端展示用） */
export interface SiteSettings {
  name: string;
  logo: string;
  version: string;
  footerCopyright: string;
  footerShowVersion: boolean;
  tabShowName: boolean;
  tabTitle: string;
}

/** KV 键 → 结构化字段 的映射（新增设置项只需在此加一行 + 前端对应字段） */
const KEY_TO_FIELD = {
  "site.name": "name",
  "site.logo": "logo",
  "site.version": "version",
  "site.footer.copyright": "footerCopyright",
  "site.footer.showVersion": "footerShowVersion",
  "site.tab.showName": "tabShowName",
  "site.tab.title": "tabTitle",
} as const;

type Field = keyof typeof KEY_TO_FIELD;

const DEFAULTS: Record<Field, string> = {
  "site.name": "Meeting",
  "site.logo": "/favicon.svg",
  "site.version": "",
  "site.footer.copyright": "",
  "site.footer.showVersion": "N",
  "site.tab.showName": "Y",
  "site.tab.title": "",
};

const CACHE_TTL = 60_000;
const cache = new Map<string, { value: SiteSettings; expires: number }>();

function rowToSettings(rows: Array<{ site_key: string; site_value: string }>): SiteSettings {
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.site_key, r.site_value);
  const get = (k: Field): string => map.get(k) ?? DEFAULTS[k];
  return {
    name: get("site.name"),
    logo: get("site.logo"),
    version: get("site.version"),
    footerCopyright: get("site.footer.copyright"),
    footerShowVersion: get("site.footer.showVersion") === "Y",
    tabShowName: get("site.tab.showName") === "Y",
    tabTitle: get("site.tab.title"),
  };
}

/** 读取站点设置（带缓存；表不存在等异常时回退默认值，避免页面崩溃） */
export async function getSiteSettings(db: Db): Promise<SiteSettings> {
  const cached = cache.get("all");
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const [rows] = await db.query(
      `SELECT site_key, site_value FROM sys_site_settings`,
    );
    const settings = rowToSettings(rows as Array<{ site_key: string; site_value: string }>);
    cache.set("all", { value: settings, expires: Date.now() + CACHE_TTL });
    return settings;
  } catch {
    return rowToSettings([]);
  }
}

/** 失效缓存：更新站点设置后调用，确保下次读取拿到新值 */
export function invalidateSiteSettings(): void {
  cache.delete("all");
}
