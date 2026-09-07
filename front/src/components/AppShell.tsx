import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Avatar,
  Layout,
  Menu,
  Modal,
  Tooltip,
  theme,
} from "antd";
import {
  HomeOutlined,
  TeamOutlined,
  LockOutlined,
  LogoutOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import {
  clearSession,
  getDisplayName,
} from "@/auth/session";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { api } from "@/api/client";
import { ThemeToggle } from "@/theme/ThemeToggle";

const { Sider, Content } = Layout;

function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function AppShellInner() {
  const { t } = useTranslation();
  const { modal, message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const displayName = getDisplayName();
  const [pwdOpen, setPwdOpen] = useState(false);
  const { canInstall, installed, promptInstall } = useInstallPrompt();

  // ── 登录后提示修改密码（默认密码/密码过期），非强制 ──
  useEffect(() => {
    if (sessionStorage.getItem("mustChangePassword") === "1") {
      sessionStorage.removeItem("mustChangePassword");
      setPwdOpen(true);
    }
    sessionStorage.removeItem("forceChangePassword");
  }, []);

  // ── 空闲超时 ──
  const [idleConfig, setIdleConfig] = useState({ timeoutSec: 600, warningSec: 60 });
  useEffect(() => {
    api<{ idleTimeout: number; idleWarning: number }>("/sys-config/public")
      .then((cfg) => setIdleConfig({ timeoutSec: cfg.idleTimeout, warningSec: cfg.idleWarning }))
      .catch(() => {});
  }, []);

  const { showWarning, remainingSec } = useIdleTimer({
    timeoutSec: idleConfig.timeoutSec,
    warningSec: idleConfig.warningSec,
    onTimeout: () => {
      // 空闲自动退出也通知服务端注销会话，释放“在线人数”名额
      void api("/auth/logout", { method: "POST" }).catch(() => {});
      clearSession();
      message.warning(t("idle.timeoutMessage"));
      navigate("/login", { replace: true });
    },
    onWarning: () => {
      message.warning(t("idle.warningMessage"));
    },
  });

  function onLogout() {
    modal.confirm({
      title: t("nav.confirmLogout"),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        await api("/auth/logout", { method: "POST" }).catch(() => {});
        clearSession();
        navigate("/login", { replace: true });
      },
    });
  }

  async function onInstall() {
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      !(window as unknown as { MSStream?: unknown }).MSStream;
    if (isIOS) {
      modal.info({
        title: t("pwa.installTitle"),
        content: t("pwa.iosHint"),
        okText: t("common.confirm"),
      });
      return;
    }
    const accepted = await promptInstall();
    if (accepted) {
      message.success(t("pwa.installed"));
    }
  }

  const menuItems = [
    {
      key: "/",
      icon: <HomeOutlined />,
      label: <NavLink to="/" end>{t("nav.meetings")}</NavLink>,
    },
    {
      key: "/groups",
      icon: <TeamOutlined />,
      label: <NavLink to="/groups">{t("group.title")}</NavLink>,
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        width={72}
        collapsed
        collapsedWidth={72}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          overflow: "hidden",
          background: token.colorBgContainer,
        }}
      >
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 16 }}>
          <Avatar
            size={40}
            style={{ background: token.colorPrimary, fontSize: "0.75rem", fontWeight: 600 }}
          >
            {initialsFromName(displayName)}
          </Avatar>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          style={{
            flex: 1,
            background: "transparent",
            borderInlineEnd: "none",
          }}
        />

        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingBottom: 16, marginTop: "auto" }}>
          <ThemeToggle />
          {!installed && (canInstall || /iPad|iPhone|iPod/.test(navigator.userAgent)) && (
            <Tooltip title={t("pwa.install")}>
              <button
                type="button"
                onClick={() => void onInstall()}
                aria-label={t("pwa.install")}
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "10px 4px",
                  fontSize: 22,
                  color: "inherit",
                  width: 44,
                  height: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 8,
                }}
              >
                <DownloadOutlined />
              </button>
            </Tooltip>
          )}
          <Tooltip title={t("nav.changePassword")}>
            <button
              type="button"
              onClick={() => setPwdOpen(true)}
              aria-label={t("nav.changePassword")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "10px 4px",
                fontSize: 22,
                color: "inherit",
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
              }}
            >
              <LockOutlined />
            </button>
          </Tooltip>
          <Tooltip title={t("nav.logout")}>
            <button
              type="button"
              onClick={onLogout}
              aria-label={t("nav.logout")}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: "10px 4px",
                fontSize: 22,
                color: "inherit",
                width: 44,
                height: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 8,
              }}
            >
              <LogoutOutlined />
            </button>
          </Tooltip>
        </div>
      </Sider>

      <Layout>
        <Content style={{ padding: "24px 32px", overflow: "auto" }}>
          <Outlet />
        </Content>
      </Layout>

      <ChangePasswordModal
        open={pwdOpen}
        onClose={() => setPwdOpen(false)}
      />

      {/* 空闲超时警告弹窗 */}
      <Modal
        open={showWarning}
        title={t("idle.warningTitle")}
        footer={null}
        closable={false}
        centered
      >
        <p>{t("idle.warningText", { seconds: remainingSec })}</p>
      </Modal>
    </Layout>
  );
}

export function AppShell() {
  return <AppShellInner />;
}
