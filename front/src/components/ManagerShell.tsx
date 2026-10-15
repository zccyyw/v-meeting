import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Avatar,
  Button,
  Dropdown,
  Layout,
  Menu,
  Modal,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarsOutlined,
  BellOutlined,
  FileTextOutlined,
  LogoutOutlined,
  SettingOutlined,
  TeamOutlined,
  HomeOutlined,
  AuditOutlined,
  ScheduleOutlined,
  MonitorOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { clearSession, getDisplayName } from "@/auth/session";
import { ThemeToggle } from "@/theme/ThemeToggle";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { api, SysMenuApi } from "@/api/client";
import { getIcon } from "@/components/iconRegistry";
const { Header, Sider, Content } = Layout;

/**
 * 侧栏图标映射：sys_menu 未存图标字段，按菜单 path 前端配置。
 * 后台新增菜单若未在此映射，则不显示图标（不影响功能）。
 */
const NAV_ICON_MAP: Record<string, React.ReactNode> = {
  user: <TeamOutlined />,
  role: <ApartmentOutlined />,
  menu: <AppstoreOutlined />,
  dept: <BarsOutlined />,
  config: <SettingOutlined />,
  notice: <BellOutlined />,
  log: <FileTextOutlined />,
  operlog: <FileTextOutlined />,
  approval: <AuditOutlined />,
  "meeting-approval": <ScheduleOutlined />,
  "user-approval": <AuditOutlined />,
  "meeting-monitor": <MonitorOutlined />,
};

type NavMenuNode = {
  menuId: number;
  menuName: string;
  path: string;
  icon?: string;
  menuType: "M" | "C" | "F";
  children?: NavMenuNode[];
};

function ManagerShellInner() {
  const { t } = useTranslation();
  const { modal, message } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  // 侧栏收起状态持久化：刷新后保持上次的展开/收起
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("manager.siderCollapsed") === "1",
  );
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      localStorage.setItem("manager.siderCollapsed", c ? "0" : "1");
      return !c;
    });
  const [pwdOpen, setPwdOpen] = useState(false);
  const displayName = getDisplayName();

  // ── 侧栏菜单：后台「菜单管理」动态加载（两级：目录 → 页面）──
  const [navMenus, setNavMenus] = useState<NavMenuNode[]>([]);
  useEffect(() => {
    SysMenuApi.routes()
      .then((res) => {
        // 根目录「系统管理」(menuId=1) 不作为侧栏一级展示，由其子级构成
        const root = res.tree.find((n) => n.menuId === 1);
        setNavMenus((root?.children ?? res.tree ?? []) as NavMenuNode[]);
      })
      .catch(() => setNavMenus([])); // 失败降级为空菜单（路由仍可直达）
  }, []);

  // ── 空闲超时（需求 6.2：页面停留 10 分钟自动退出，覆盖管理后台）──
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

  // 当前选中的菜单 key：先精确匹配，再按最长前缀兜底（避免 /manager/user 误配 user-approval）
  const flatPages = navMenus.flatMap((n) => {
    if (n.menuType === "C") return [{ key: `/manager/${n.path}`, name: n.menuName }];
    return (n.children ?? [])
      .filter((c) => c.menuType === "C")
      .map((c) => ({ key: `/manager/${c.path}`, name: c.menuName }));
  });
  const selectedKey =
    flatPages.find((p) => p.key === location.pathname)?.key ??
    flatPages
      .filter((p) => location.pathname.startsWith(p.key))
      .sort((a, b) => b.key.length - a.key.length)[0]?.key ??
    flatPages[0]?.key ??
    "/manager/user";

  // 菜单项：C=一级项；M=可展开二级组（组内 C 为子菜单）
  // 图标优先取后台配置的 sys_menu.icon（注册表解析），其次按 path 的前端兜底映射
  const menuItems: MenuProps["items"] = navMenus.map((node) => {
    const key = `/manager/${node.path}`;
    const icon = getIcon(node.icon) ?? NAV_ICON_MAP[node.path];
    if (node.menuType === "M") {
      const children = (node.children ?? [])
        .filter((c) => c.menuType === "C")
        .map((c) => {
          const childKey = `/manager/${c.path}`;
          return {
            key: childKey,
            icon: getIcon(c.icon) ?? NAV_ICON_MAP[c.path],
            label: <NavLink to={childKey}>{c.menuName}</NavLink>,
          };
        });
      if (children.length === 0) return null;
      return { key, icon, label: node.menuName, children };
    }
    return {
      key,
      icon,
      label: <NavLink to={key}>{node.menuName}</NavLink>,
    };
  }).filter(Boolean) as MenuProps["items"];

  function onLogout() {
    modal.confirm({
      title: t("nav.confirmLogout"),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        // 通知服务端注销会话，立即释放“在线人数”名额
        await api("/auth/logout", { method: "POST" }).catch(() => {});
        clearSession();
        // 退出后跳主站登录页（/manager/login 仅手动输入 URL 可达）
        navigate("/login", { replace: true });
      },
    });
  }

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* ── Top Header ── */}
      <Header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          height: 56,
          lineHeight: "56px",
          position: "sticky",
          top: 0,
          zIndex: 100,
          boxShadow: `0 1px 4px ${token.colorFillSecondary}`,
        }}
      >
        {/* Logo + 系统名称 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: token.colorPrimary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            M
          </div>
          <Typography.Title level={4} style={{ margin: 0, lineHeight: "56px" }}>
            {t("nav.systemManagement")}
          </Typography.Title>
        </div>

        {/* 右侧：返回会议 + 主题切换 + 用户头像（悬浮菜单：修改密码 / 退出） */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <Tooltip title={t("nav.backToMeetings")}>
            <Button
              type="text"
              icon={<HomeOutlined style={{ fontSize: 18 }} />}
              onClick={() => navigate("/")}
              aria-label={t("nav.backToMeetings")}
            />
          </Tooltip>
          <ThemeToggle />
          <Dropdown
            trigger={["hover"]}
            placement="bottomRight"
            menu={{
              items: [
                {
                  key: "changePassword",
                  icon: <LockOutlined />,
                  label: t("nav.changePassword"),
                },
                { type: "divider" },
                {
                  key: "logout",
                  icon: <LogoutOutlined />,
                  label: t("nav.logout"),
                  danger: true,
                },
              ],
              onClick: ({ key }) => {
                if (key === "changePassword") setPwdOpen(true);
                else if (key === "logout") onLogout();
              },
            }}
          >
            {/* 头像区：hover 弹出 修改密码/退出 菜单 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                marginLeft: 8,
              }}
              aria-label={t("nav.userMenu")}
            >
              <Typography.Text style={{ fontSize: 14 }}>
                {displayName || "Admin"}
              </Typography.Text>
              <Avatar size={32} style={{ background: token.colorPrimary }}>
                {(displayName || "?").slice(0, 2).toUpperCase()}
              </Avatar>
            </div>
          </Dropdown>
        </div>
      </Header>

      {/* ── 下方：左侧菜单 + 右侧内容 ── */}
      <Layout>
        {/* 左侧菜单 */}
        <Sider
          width={210}
          collapsed={collapsed}
          collapsedWidth={64}
          trigger={null}
          style={{
            // visible：半圆把手骑缝在右边缘，不能被裁剪（菜单滚动由 Menu 自身 overflow:auto 负责）
            overflow: "visible",
            height: "calc(100vh - 56px)",
            position: "sticky",
            top: 56,
            left: 0,
            background: token.colorBgContainer,
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            defaultOpenKeys={navMenus
              .filter((n) => n.menuType === "M")
              .map((n) => `/manager/${n.path}`)}
            items={menuItems}
            style={{ flex: 1, borderRight: 0, background: "transparent", overflow: "auto" }}
          />

          {/* 半圆把手：左缘与 Sider 右边框对齐、垂直居中，点击切换收起/展开 */}
          <button
            type="button"
            aria-label={t(collapsed ? "nav.expandMenu" : "nav.collapseMenu")}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
            style={{
              position: "absolute",
              right: -22,
              top: "50%",
              transform: "translateY(-50%)",
              // 宽 = 高的一半（22×44）→ 右侧 border-radius 构成完整半圆
              width: 22,
              height: 44,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderLeft: 0,
              borderRadius: "0 22px 22px 0",
              color: token.colorTextSecondary,
              cursor: "pointer",
              transition: "background 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = token.colorPrimaryBg;
              e.currentTarget.style.color = token.colorPrimary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = token.colorBgContainer;
              e.currentTarget.style.color = token.colorTextSecondary;
            }}
          >
            {collapsed ? (
              <MenuUnfoldOutlined style={{ fontSize: 11 }} />
            ) : (
              <MenuFoldOutlined style={{ fontSize: 11 }} />
            )}
          </button>
        </Sider>

        {/* 右侧主内容 */}
        <Content
          style={{
            padding: 20,
            margin: 0,
            minHeight: "calc(100vh - 56px)",
            background: token.colorBgLayout,
          }}
        >
          <Outlet />
        </Content>
      </Layout>

      <ChangePasswordModal open={pwdOpen} onClose={() => setPwdOpen(false)} />

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

export function ManagerShell() {
  return <ManagerShellInner />;
}
