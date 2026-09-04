import { Button, Tooltip } from "antd";
import { SunOutlined, MoonOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useThemeMode } from "./ThemeProvider";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { mode, toggle } = useThemeMode();

  return (
    <Tooltip title={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}>
      <Button
        type="text"
        icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
        onClick={toggle}
        aria-label={mode === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
        style={{ fontSize: 18 }}
      />
    </Tooltip>
  );
}
