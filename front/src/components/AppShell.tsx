import { useState, useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Avatar,
  Button,
  Layout,
  Menu,
  Modal,
  Popover,
  Tag,
  Tooltip,
  theme,
} from "antd";
import {
  HomeOutlined,
  TeamOutlined,
  SettingOutlined,
  LockOutlined,
  LogoutOutlined,
  DownloadOutlined,
} from "@ant-design/icons";
import {
  clearSession,
  getDisplayName,
  getRole,
  getRoles,
  getUsername,
  isManager,
} from "@/auth/session";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { NotificationBell } from "@/components/NotificationBell";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { api } from "@/api/client";
import { ThemeToggle } from "@/theme/ThemeToggle";
import { SiteBrand } from "@/site/SiteBrand";
import { SiteFooter } from "@/site/SiteFooter";

const { Sider, Content } = Layout;

// 角色 → i18n 键；未登记的角色直接显示原始 key，避免信息丢失
const ROLE_LABEL_KEYS: Record<string, string> = {
  admin: "nav.roleSysAdmin",
  sys_admin: "nav.roleSysAdmin",
  auth_admin: "nav.roleAuthAdmin",
  audit_admin: "nav.roleAuditAdmin",
  user: "nav.roleUser",
};

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
  // 头像浮窗：hover 展开个人信息 / 修改密码 / 退出系统
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const username = getUsername();
  // 角色标签：优先取多角色，缺失时回退到单角色字段
  const roleNames = (() => {
    const keys = getRoles();
    const list = keys.length > 0 ? keys : [getRole() === "admin" ? "admin" : "user"];
    const names: string[] = [];
    for (const key of list) {
      const labelKey = ROLE_LABEL_KEYS[key];
      const name = labelKey ? t(labelKey) : key;
      if (!names.includes(name)) names.push(name);
    }
    return names;
  })();
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
    // 管理后台入口：仅管理角色（系统管理员/授权管理员/审计管理员）可见；
    // 未登录管理后台时由 /manager 路由守卫引导至管理登录页
    ...(isManager()
      ? [
          {
            key: "/manager",
            icon: <SettingOutlined />,
            label: <NavLink to="/manager">{t("nav.manager")}</NavLink>,
          },
        ]
      : []),
  ];

  // 头像浮窗内容：个人信息 + 修改密码 + 退出系统
  const userMenu = (
    <div style={{ width: 220 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "2px 2px 10px" }}>
        <Avatar
          size={40}
          style={{
            background: token.colorPrimary,
            fontSize: "0.75rem",
            fontWeight: 600,
            flex: "none",
          }}
        >
          {initialsFromName(displayName)}
        </Avatar>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: "20px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName || "—"}
          </div>
          {username && (
            <div
              style={{
                fontSize: 12,
                lineHeight: "18px",
                color: token.colorTextSecondary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              @{username}
            </div>
          )}
          {roleNames.length > 0 && (
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {roleNames.map((name) => (
                <Tag
                  key={name}
                  color="blue"
                  style={{ marginInlineEnd: 0, fontSize: 11, lineHeight: "16px", paddingInline: 6 }}
                >
                  {name}
                </Tag>
              ))}
            </div>
          )}
        </div>
      </div>
      <div style={{ borderTop: `1px solid ${token.colorSplit}`, margin: "0 -4px 4px" }} />
      <Button
        type="text"
        block
        icon={<LockOutlined />}
        style={{ justifyContent: "flex-start", paddingInline: 8 }}
        onClick={() => {
          setUserMenuOpen(false);
          setPwdOpen(true);
        }}
      >
        {t("nav.changePassword")}
      </Button>
      <Button
        type="text"
        block
        danger
        icon={<LogoutOutlined />}
        style={{ justifyContent: "flex-start", paddingInline: 8 }}
        onClick={() => {
          setUserMenuOpen(false);
          onLogout();
        }}
      >
        {t("nav.logoutSystem")}
      </Button>
    </div>
  );

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
          // 侧栏独立于内容滚动：内容变高（或窗口缩矮）时，底部退出/改密/主题图标
          // 不会被顶出视口（sticky 用内联样式，避免被 antd 运行时注入的样式覆盖）
          position: "sticky",
          top: 0,
          height: "100dvh",
        }}
      >
        <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 16 }}>
          {/* 站点品牌（窄侧栏下仅显示 Logo 图标） */}
          <SiteBrand showName={false} />
          <Popover
            open={userMenuOpen}
            onOpenChange={setUserMenuOpen}
            trigger={["hover", "click"]}
            placement="rightTop"
            mouseEnterDelay={0.15}
            content={userMenu}
            arrow
          >
            <button
              type="button"
              aria-label={t("nav.userMenu")}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                margin: 0,
                lineHeight: 0,
                cursor: "pointer",
                borderRadius: "50%",
              }}
            >
              <Avatar
                size={40}
                style={{ background: token.colorPrimary, fontSize: "0.75rem", fontWeight: 600 }}
              >
                {initialsFromName(displayName)}
              </Avatar>
            </button>
          </Popover>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          className="app-sider-menu"
          style={{
            flex: 1,
            background: "transparent",
            borderInlineEnd: "none",
          }}
        />

        <div className="app-sider-bottom" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingBottom: 16, marginTop: "auto" }}>
          <NotificationBell />
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

      <Layout style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Content className="app-content" style={{ flex: 1 }}>
          <Outlet />
        </Content>
        <Layout.Footer style={{ background: "transparent", padding: 0 }}>
          <SiteFooter />
        </Layout.Footer>
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
