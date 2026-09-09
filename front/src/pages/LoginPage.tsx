import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { App as AntApp, Button, Card, Form, Input, Typography, Layout } from "antd";
import { UserOutlined, LockOutlined, DownloadOutlined } from "@ant-design/icons";
import { AuthApi, API_BASE } from "@/api/client";
import { setPendingJoinCode } from "@/auth/joinPrefs";
import { persistSession } from "@/auth/session";
import { apiErrorMessage } from "@/i18n/errorMessage";
import { ThemeToggle } from "@/theme/ThemeToggle";

type FormValues = {
  username: string;
  password: string;
};

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { message } = AntApp.useApp();
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    const join = searchParams.get("join")?.replace(/\D/g, "") ?? "";
    if (join.length === 9) setPendingJoinCode(join);
  }, [searchParams]);

  async function onLogin(values: FormValues) {
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

      // 如果需要修改密码（默认密码/密码过期/强制修改），标记后跳转，AppShell 自动弹窗
      if (res.mustChangePassword || res.passwordExpired || res.forceChangePassword) {
        sessionStorage.setItem("mustChangePassword", "1");
        if (res.forceChangePassword) {
          sessionStorage.setItem("forceChangePassword", "1");
        }
      }

      navigate("/", { replace: true });
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout style={{ minHeight: "100vh", position: "relative" }}>
      {/* 右上角主题切换 */}
      <div style={{ position: "absolute", top: 16, right: 16, zIndex: 10 }}>
        <ThemeToggle />
      </div>

      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "100vh",
        width: "100%",
      }}>
        <Card style={{ width: "100%", maxWidth: 400, border: "1px solid var(--ant-color-border)" }}>
          <Typography.Title level={2} style={{ textAlign: "center", marginBottom: 8, color: "var(--ant-color-primary)" }}>
            {t("app.name")}
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ textAlign: "center", marginBottom: 24 }}>
            {t("login.hint")}
          </Typography.Paragraph>

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

          {/* 信创环境：导入 CA 根证书后浏览器才信任站点 */}
          <div style={{ marginTop: 16, textAlign: "center" }}>
            <a
              href={`${API_BASE}/certs/ca.crt`}
              style={{ fontSize: 13 }}
              download
            >
              <DownloadOutlined style={{ marginRight: 4 }} />
              {t("login.downloadCaCert")}
            </a>
            <Typography.Paragraph
              type="secondary"
              style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}
            >
              {t("login.caCertTip")}
            </Typography.Paragraph>
          </div>
        </Card>
      </div>
    </Layout>
  );
}
