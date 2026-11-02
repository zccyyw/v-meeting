import { useResolvedLogo, useSiteSettings } from "./SiteSettingsContext";

/** 站点品牌：Logo + 项目名称。showName=false 时仅显示图标（用于窄侧栏）。 */
export function SiteBrand({ showName = true }: { showName?: boolean }) {
  const settings = useSiteSettings();
  const logo = useResolvedLogo();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      <img
        src={logo}
        alt="logo"
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          objectFit: "contain",
          flex: "0 0 auto",
        }}
      />
      {showName && (
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {settings?.name || "Meeting"}
        </span>
      )}
    </div>
  );
}
