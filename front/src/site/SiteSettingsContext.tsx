import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { API_BASE, SiteSettingsApi, type SiteSettings } from "@/api/client";

export type { SiteSettings };

const Ctx = createContext<SiteSettings | null>(null);

/**
 * 把站点 logo 地址转为浏览器可直接使用的 URL：
 *  - 完整 http(s) URL：原样；
 *  - /branding/...：经 /api 前缀（caddy 会去掉 /api 落到后端 /branding/:file）；
 *  - 其它（如 /favicon.svg）：视为 web 静态资源，原样。
 */
export function resolveLogoUrl(logo: string | undefined): string {
  if (!logo) return "/favicon.svg";
  if (/^https?:\/\//.test(logo)) return logo;
  if (logo.startsWith("/branding/")) return `${API_BASE}${logo}`;
  return logo;
}

export function SiteSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    // 会话前也拉取，供登录页 / 页签标题 / favicon 使用
    SiteSettingsApi.get()
      .then(setSettings)
      .catch(() => {
        /* 失败则用默认值（Meeting / favicon.svg），不阻塞页面 */
      });
  }, []);

  useEffect(() => {
    if (!settings) return;
    const title = settings.tabShowName ? settings.tabTitle || settings.name : "Meeting";
    document.title = title;
    const logo = resolveLogoUrl(settings.logo);
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = logo;
  }, [settings]);

  return <Ctx.Provider value={settings}>{children}</Ctx.Provider>;
}

export function useSiteSettings(): SiteSettings | null {
  return useContext(Ctx);
}

export function useResolvedLogo(): string {
  const s = useContext(Ctx);
  return resolveLogoUrl(s?.logo);
}
