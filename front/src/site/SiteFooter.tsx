import { useSiteSettings } from "./SiteSettingsContext";
import { APP_VERSION } from "./version";

/** 站点页脚：版权文本（可选）+ 版本标识（可选）。两者皆空则不渲染。 */
export function SiteFooter() {
  const settings = useSiteSettings();
  const copyright = settings?.footerCopyright?.trim();
  const showVersion = settings?.footerShowVersion;
  if (!copyright && !showVersion) return null;
  const versionText = showVersion ? `v${settings?.version || APP_VERSION}` : "";
  return (
    <div
      style={{
        textAlign: "center",
        padding: "12px 16px",
        color: "rgba(0,0,0,0.45)",
        fontSize: 12,
        lineHeight: "20px",
      }}
    >
      {[copyright, versionText].filter(Boolean).join(" · ")}
    </div>
  );
}
