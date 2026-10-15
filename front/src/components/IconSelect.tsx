import { useMemo, useState } from "react";
import { Input, Popover, Tooltip } from "antd";
import { getIcon, ICON_ITEMS, resolveIconName } from "./iconRegistry";

/**
 * 若依式图标选择控件：只读输入框（前缀显示当前图标）+ 弹出图标网格（可搜索）。
 * 存储值为 antd 图标组件全名（如 TeamOutlined）；清空后存 "#"（与后端默认一致）。
 * Form.Item 直接包裹即可接入（受控 value/onChange）。
 */
export function IconSelect({
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  clearText,
}: {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  clearText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const resolved = resolveIconName(value);
  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    if (!kw) return ICON_ITEMS;
    return ICON_ITEMS.filter(
      (i) => i.name.toLowerCase().includes(kw) || i.alias.toLowerCase().includes(search.trim()),
    );
  }, [search]);

  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={open}
      onOpenChange={setOpen}
      overlayInnerStyle={{ padding: 12 }}
      content={
        <div style={{ width: 336 }}>
          <Input
            allowClear
            size="small"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div
            style={{
              marginTop: 8, maxHeight: 240, overflow: "auto",
              display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4,
            }}
          >
            {filtered.map(({ name }) => (
              <Tooltip key={name} title={name} mouseEnterDelay={0.3}>
                <div
                  onClick={() => {
                    onChange?.(name);
                    setOpen(false);
                  }}
                  style={{
                    height: 40, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, cursor: "pointer", borderRadius: 6,
                    border: resolved === name ? "1px solid #1677ff" : "1px solid transparent",
                    background: resolved === name ? "#e6f4ff" : undefined,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f5f5")}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = resolved === name ? "#e6f4ff" : undefined)
                  }
                >
                  {getIcon(name)}
                </div>
              </Tooltip>
            ))}
            {filtered.length === 0 && (
              <div style={{ gridColumn: "1 / -1", textAlign: "center", color: "#999", padding: 16 }}>
                − 0 −
              </div>
            )}
          </div>
          {resolved && (
            <div style={{ marginTop: 8, textAlign: "right" }}>
              <a
                onClick={() => {
                  onChange?.("#");
                  setOpen(false);
                }}
              >
                {clearText}
              </a>
            </div>
          )}
        </div>
      }
    >
      <Input
        readOnly
        value={resolved ?? ""}
        placeholder={placeholder}
        prefix={resolved ? getIcon(resolved) : undefined}
        style={{ cursor: "pointer" }}
      />
    </Popover>
  );
}
