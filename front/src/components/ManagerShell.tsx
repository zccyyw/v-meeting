import { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Avatar,
  Button,
  Dropdown,
  Layout,
  Menu,
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
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { clearSession, getDisplayName, getRoles } from "@/auth/session";
import { ThemeToggle } from "@/theme/ThemeToggle";
import { ChangePasswordModal } from "@/components/ChangePasswordModal";

const { Header, Sider, Content } = Layout;

/**
 * 导航项定义：每项关联所需角色或权限。
 * - admin（超级管理员）可见全部
 * - sys_admin: 用户管理、部门管理、参数设置
 * - auth_admin: 用户审批、会议审批、登录日志
 * - audit_admin: 操作日志
 */
const navItems = [
  { key: "/manager/user", icon: <TeamOutlined />, labelKey: "nav.users",
    roles: ["admin", "sys_admin"] },
  { key: "/manager/role", icon: <ApartmentOutlined />, labelKey: "nav.roles",
    roles: ["admin"] },
  { key: "/manager/menu", icon: <AppstoreOutlined />, labelKey: "nav.menus",
    roles: ["admin"] },
  { key: "/manager/dept", icon: <BarsOutlined />, labelKey: "nav.depts",
    roles: ["admin", "sys_admin"] },
  { key: "/manager/config", icon: <SettingOutlined />, labelKey: "nav.configs",
    roles: ["admin", "sys_admin"] },
  { key: "/manager/notice", icon: <BellOutlined />, labelKey: "nav.notices",
    roles: ["admin"] },
  { key: "/manager/operlog", icon: <FileTextOutlined />, labelKey: "nav.logs",
    roles: ["admin", "auth_admin", "audit_admin"] },
  { key: "/manager/meeting-approval", icon: <ScheduleOutlined />, labelKey: "nav.meetingApproval",
    roles: ["admin", "auth_admin"] },
  { key: "/manager/meeting-monitor", icon: <MonitorOutlined />, labelKey: "nav.meetingMonitor",
    roles: ["admin", "auth_admin", "audit_admin"] },
  { key: "/manager/user-approval", icon: <AuditOutlined />, labelKey: "nav.userApproval",
    roles: ["admin", "auth_admin"] },
];

/**
 * 根据用户角色过滤可见的导航项。
 * 如果用户有 admin 角色或对应的权限标识，则可见。
 */
function filterNavItems(): typeof navItems {
  const roles = getRoles();
  // 超级管理员可见全部
  if (roles.includes("admin")) return navItems;
  return navItems.filter((item) =>
    item.roles.some((r) => roles.includes(r))
  );
}

function ManagerShellInner() {
  const { t } = useTranslation();
  const { modal } = AntApp.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);
  const [pwdOpen, setPwdOpen] = useState(false);
  const displayName = getDisplayName();

  // 当前选中的菜单 key
  const visibleNavItems = filterNavItems();
  const selectedKey = visibleNavItems.find(
    (item) => location.pathname.startsWith(item.key),
  )?.key ?? visibleNavItems[0]?.key ?? "/manager/user";

  // 菜单项
  const menuItems: MenuProps["items"] = visibleNavItems.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: (
      <NavLink to={item.key}>
        {t(item.labelKey)}
      </NavLink>
    ),
  }));

  function onLogout() {
    modal.confirm({
      title: t("nav.confirmLogout"),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: () => {
        clearSession();
        navigate("/manager/login", { replace: true });
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
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          style={{
            overflow: "hidden",
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
            items={menuItems}
            style={{ flex: 1, borderRight: 0, background: "transparent", overflow: "auto" }}
          />
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
    </Layout>
  );
}

export function ManagerShell() {
  return <ManagerShellInner />;
}
