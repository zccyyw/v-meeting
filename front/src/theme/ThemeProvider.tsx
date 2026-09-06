import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { App as AntApp, ConfigProvider, theme } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { useTranslation } from "react-i18next";

export type ThemeMode = "light" | "dark";

type ThemeContextValue = {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  toggle: () => {},
  setMode: () => {},
});

export function useThemeMode(): ThemeContextValue {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "app-theme-mode";

function getInitialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore
  }
  // 默认明亮模式（不跟随系统偏好）
  return "light";
}

/** 全局主题 Token — 不硬编码颜色，统一从此处管理 */
export function useGlobalToken() {
  const { token } = theme.useToken();
  return token;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);

  const antdLocale = i18n.language.startsWith("zh") ? zhCN : enUS;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
    // 更新 <html> data-theme 属性，方便 CSS 按主题区分
    document.documentElement.setAttribute("data-theme", mode);
  }, [mode]);

  function setMode(next: ThemeMode) {
    setModeState(next);
  }

  function toggle() {
    setModeState((prev) => (prev === "light" ? "dark" : "light"));
  }

  const ctxValue = useMemo(() => ({ mode, toggle, setMode }), [mode, toggle, setMode]);

  const algorithm = mode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm;

  return (
    <ThemeContext.Provider value={ctxValue}>
      <ConfigProvider
        locale={antdLocale}
        theme={{
          algorithm,
          token: {
            colorPrimary: "#1278ff",
            borderRadius: 8,
          },
          components: {
            Layout: {
              // 暗色模式下侧边栏更深
              siderBg: mode === "dark" ? "#141414" : "#001529",
              headerBg: mode === "dark" ? "#1f1f1f" : "#ffffff",
              bodyBg: mode === "dark" ? "#141414" : "#f0f2f5",
            },
          },
        }}
      >
        <AntApp>{children}</AntApp>
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
