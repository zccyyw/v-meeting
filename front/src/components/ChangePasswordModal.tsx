import { useState } from "react";
import { useTranslation } from "react-i18next";
import { App as AntApp, Alert, Form, Input, Modal } from "antd";
import { AuthApi } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";
import { PasswordStrengthHint } from "@/components/PasswordStrengthHint";

type Props = {
  open: boolean;
  onClose: () => void;
};

type FormValues = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export function ChangePasswordModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<FormValues>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function handleClose() {
    form.resetFields();
    setDone(false);
    onClose();
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      setBusy(true);
      await AuthApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      setDone(true);
      message.success(t("account.changePasswordSuccess"));
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={t("account.changePassword")}
      onCancel={handleClose}
      closable
      maskClosable
      onOk={() => void onSubmit()}
      confirmLoading={busy}
      okText={done ? t("common.confirm") : t("common.save")}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: done }}
      cancelButtonProps={{ style: { display: done ? "none" : undefined } }}
      destroyOnHidden
      centered
      width={420}
    >
      <div style={{ display: done ? "none" : undefined }}>
        <Form
          form={form}
          layout="vertical"
          requiredMark
          className="admin-antd-form"
          style={{ marginTop: 8 }}
        >
          <Form.Item
            name="currentPassword"
            label={t("account.currentPassword")}
            rules={[
              { required: true, message: t("account.currentPasswordRequired") },
            ]}
          >
            <Input.Password autoComplete="current-password" autoFocus />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label={t("account.newPassword")}
            rules={[
              { required: true, message: t("account.newPasswordRequired") },
              { min: 6, max: 128, message: t("errors.password_too_short") },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item shouldUpdate>
            {({ getFieldValue }) => (
              <PasswordStrengthHint password={getFieldValue("newPassword") || ""} />
            )}
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t("account.confirmPassword")}
            dependencies={["newPassword"]}
            rules={[
              { required: true, message: t("account.confirmPasswordRequired") },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (value !== getFieldValue("newPassword")) {
                    return Promise.reject(new Error(t("errors.password_mismatch")));
                  }
                  return Promise.resolve();
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </div>
      {done && (
        <Alert
          type="success"
          showIcon
          message={t("account.changePasswordSuccess")}
          style={{ margin: 0 }}
        />
      )}
    </Modal>
  );
}
