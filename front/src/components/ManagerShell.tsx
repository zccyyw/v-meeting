import { useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Avatar,
  Dropdown,
  Layout,
  Menu,
  Space,
  Typography,
  theme,
} from "antd";
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BarsOutlined,
  BellOutlined,
  DownOutlined,
  FileTextOutlined,
  LogoutOutlined,
  SettingOutlined,
  TeamOutlined,
  HomeOutlined,
  AuditOutlined,
  ScheduleOutlined,
  MonitorOutlined,
} from "@ant-design/icons";
import type { MenuProps } from "antd";
import { clearSession, getDisplayName, getRoles } from "@/auth/session";
import { ThemeToggle } from "@/theme/ThemeToggle";

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

  // 头像下拉菜单
  const avatarMenuItems: MenuProps["items"] = [
    {
      key: "back",
      icon: <HomeOutlined />,
      label: t("nav.backToMeetings"),
    },
    { type: "divider" },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: t("nav.logout"),
      danger: true,
    },
  ];

  function onAvatarMenuClick({ key }: { key: string }) {
    if (key === "back") {
      navigate("/");
    } else if (key === "logout") {
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
        <Space size={12}>
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
        </Space>

        {/* 右侧：主题切换 + 头像 + 下拉 */}
        <Space size={8}>
          <ThemeToggle />
          <Dropdown
            menu={{ items: avatarMenuItems, onClick: onAvatarMenuClick }}
            placement="bottomRight"
          >
            <Space size={8} style={{ cursor: "pointer" }}>
              <Avatar
                size={32}
                style={{ background: token.colorPrimary }}
              >
                {(displayName || "?").slice(0, 2).toUpperCase()}
              </Avatar>
              <Typography.Text style={{ fontSize: 14 }}>
                {displayName || "Admin"}
              </Typography.Text>
              <DownOutlined style={{ fontSize: 12, color: token.colorTextSecondary }} />
            </Space>
          </Dropdown>
        </Space>
      </Header>

      {/* ── 下方：左侧菜单 + 右侧内容 ── */}
      <Layout>
        {/* 左侧菜单 */}
        <Sider
          width={210}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          theme="dark"
          style={{
            overflow: "auto",
            height: "calc(100vh - 56px)",
            position: "sticky",
            top: 56,
            left: 0,
          }}
        >
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            style={{ borderRight: 0 }}
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
    </Layout>
  );
}

export function ManagerShell() {
  return <ManagerShellInner />;
}
