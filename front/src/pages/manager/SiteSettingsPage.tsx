import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { App as AntApp, Button, Card, Form, Input, Switch, Space, Upload, Typography } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { SiteSettingsApi, type SiteSettings } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";
import { APP_VERSION } from "@/site/version";
import { SiteBrand } from "@/site/SiteBrand";
import { SiteFooter } from "@/site/SiteFooter";
import { resolveLogoUrl } from "@/site/SiteSettingsContext";

export function SiteSettingsPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<SiteSettings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");

  useEffect(() => {
    SiteSettingsApi.get()
      .then((s) => {
        form.setFieldsValue(s);
        setLogoUrl(s.logo);
      })
      .catch((e) => message.error(apiErrorMessage(t, e)))
      .finally(() => setLoading(false));
  }, [form, message, t]);

  async function onLogo(file: File) {
    try {
      const { url } = await SiteSettingsApi.uploadLogo(file);
      setLogoUrl(url);
      form.setFieldsValue({ logo: url });
      message.success(t("common.uploadSuccess"));
    } catch (e) {
      message.error(apiErrorMessage(t, e));
    }
  }

  async function onSave() {
    const values = await form.validateFields();
    setSaving(true);
    try {
      await SiteSettingsApi.update(values);
      message.success(t("common.updateSuccess"));
      // 保存后刷新整页，确保全局 provider 与页签/favicon 立即生效
      window.location.reload();
    } catch (e) {
      message.error(apiErrorMessage(t, e));
    } finally {
      setSaving(false);
    }
  }

  const previewLogo = resolveLogoUrl(logoUrl || "/favicon.svg");

  return (
    <div className="admin-page">
      <Typography.Title level={3} style={{ margin: 0 }}>
        {t("site.title")}
      </Typography.Title>

      <Card style={{ marginTop: 16, maxWidth: 720 }} loading={loading}>
        <Form
          form={form}
          layout="vertical"
          initialValues={{ footerShowVersion: false, tabShowName: true }}
        >
          <Form.Item
            name="name"
            label={t("site.name")}
            rules={[{ required: true, message: t("site.nameRequired") }]}
          >
            <Input maxLength={100} />
          </Form.Item>

          <Form.Item label={t("site.logo")}>
            <Space align="center">
              <img
                src={previewLogo}
                alt="logo"
                style={{
                  width: 48,
                  height: 48,
                  objectFit: "contain",
                  border: "1px solid #eee",
                  borderRadius: 6,
                }}
              />
              <Upload
                beforeUpload={(f) => {
                  void onLogo(f as File);
                  return false;
                }}
                showUploadList={false}
                accept=".png,.jpg,.jpeg,.svg"
              >
                <Button icon={<UploadOutlined />}>{t("site.uploadLogo")}</Button>
              </Upload>
              <span style={{ color: "rgba(0,0,0,0.45)", fontSize: 12 }}>
                {t("site.logoHint")}
              </span>
            </Space>
          </Form.Item>

          <Form.Item name="version" label={t("site.version")}>
            <Input placeholder={APP_VERSION} maxLength={50} />
          </Form.Item>

          <Form.Item name="footerCopyright" label={t("site.footerCopyright")}>
            <Input.TextArea rows={2} maxLength={500} placeholder={t("site.footerCopyrightHint")} />
          </Form.Item>

          <Form.Item
            name="footerShowVersion"
            label={t("site.footerShowVersion")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>

          <Form.Item name="tabShowName" label={t("site.tabShowName")} valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item name="tabTitle" label={t("site.tabTitle")}>
            <Input maxLength={200} placeholder={t("site.tabTitleHint")} />
          </Form.Item>

          <Space>
            <Button type="primary" loading={saving} onClick={onSave}>
              {t("common.save")}
            </Button>
            <Button onClick={() => window.location.reload()}>{t("common.reset")}</Button>
          </Space>
        </Form>
      </Card>

      <Card style={{ marginTop: 16, maxWidth: 720 }} title={t("site.preview")}>
        <SiteBrand />
        <div style={{ marginTop: 12 }}>
          <SiteFooter />
        </div>
      </Card>
    </div>
  );
}
