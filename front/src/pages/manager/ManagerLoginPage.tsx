import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { App as AntApp, Form, Input, Button, Typography, theme } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { AuthApi } from "@/api/client";
import { persistSession, isManager } from "@/auth/session";
import { apiErrorMessage } from "@/i18n/errorMessage";
import { ThemeToggle } from "@/theme/ThemeToggle";

function ManagerLoginInner() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ username: string; password: string }>();

  async function onLogin(values: { username: string; password: string }) {
    setBusy(true);
    try {
      const res = await AuthApi.login({
        username: values.username.trim(),
        password: values.password,
      });
      persistSession({
        sessionId: res.sessionId,
        userId: res.userId,
        displayName: res.displayName,
        role: res.role,
        roles: res.roles,
        permissions: res.permissions,
        username: res.username,
      });

      // 如果需要修改密码（默认密码/密码过期/强制修改），标记后跳转，ManagerShell 弹窗提示
      if (res.mustChangePassword || res.passwordExpired || res.forceChangePassword) {
        sessionStorage.setItem("mustChangePassword", "1");
        if (res.forceChangePassword) {
          sessionStorage.setItem("forceChangePassword", "1");
        }
      }

      // 检查是否有管理权限
      if (!isManager()) {
        message.error(t("manager.login.noPermission"));
        return;
      }

      // 根据角色跳转到有权限的第一个页面
      const roles = res.roles ?? [];
      let defaultPath = "/manager/user";
      if (roles.includes("admin")) defaultPath = "/manager/user";
      else if (roles.includes("sys_admin")) defaultPath = "/manager/user";
      else if (roles.includes("auth_admin")) defaultPath = "/manager/meeting-approval";
      else if (roles.includes("audit_admin")) defaultPath = "/manager/operlog";

      navigate(defaultPath, { replace: true });
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "100vh",
      background: token.colorBgLayout,
      position: "relative",
    }}>
      {/* 右上角主题切换 */}
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 10 }}>
        <ThemeToggle />
      </div>

      <div style={{ width: 380 }}>
        <Typography.Title level={2} style={{ textAlign: "center", marginBottom: 32, color: token.colorPrimary }}>
          {t("nav.systemManagement")}
        </Typography.Title>
        <div style={{
          background: token.colorBgContainer,
          padding: 32,
          borderRadius: 8,
          boxShadow: token.boxShadowSecondary,
        }}>
          <Form
            form={form}
            layout="vertical"
            onFinish={onLogin}
            requiredMark={false}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: t("login.username") }]}
            >
              <Input
                prefix={<UserOutlined />}
                placeholder={t("login.username")}
                size="large"
                autoComplete="username"
                autoFocus
              />
            </Form.Item>
            <Form.Item
              name="password"
              rules={[{ required: true, message: t("login.password") }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder={t("login.password")}
                size="large"
                autoComplete="current-password"
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                block
                loading={busy}
              >
                {t("login.submit")}
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>
    </div>
  );
}

export function ManagerLoginPage() {
  return <ManagerLoginInner />;
}
