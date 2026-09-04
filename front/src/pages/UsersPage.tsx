import { useCallback, useEffect, useState, type Key } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { UploadFile } from "antd/es/upload";
import {
  CloseOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExportOutlined,
  ImportOutlined,
  InboxOutlined,
  KeyOutlined,
  PaperClipOutlined,
  PlusOutlined,
  SearchOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  UsersApi,
  downloadExport,
  downloadImportTemplate,
  type UserRow,
} from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";
import { getUserId } from "@/auth/session";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

type FormValues = {
  username?: string;
  displayName: string;
  password?: string;
  passwordConfirm?: string;
  role: "admin" | "user";
  phone?: string;
};

function formatTime(iso: string, localeTag: string): string {
  try {
    return new Date(iso).toLocaleString(localeTag);
  } catch {
    return iso;
  }
}

function UsersPageInner() {
  const { t, i18n } = useTranslation();
  const { message } = AntApp.useApp();
  const localeTag = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const currentUserId = getUserId();

  const [q, setQ] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [items, setItems] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetForm] = Form.useForm<{ password: string }>();

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSubmitting, setImportSubmitting] = useState(false);

  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([]);

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth <= 720,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 720);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await UsersApi.list({
        q: q || undefined,
        page,
        pageSize,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [q, page, pageSize, t, message]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setModalMode("create");
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      role: "user",
      password: "",
      passwordConfirm: "",
      phone: "",
    });
    setModalOpen(true);
  }

  function openEdit(row: UserRow) {
    setModalMode("edit");
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      phone: row.phone ?? "",
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditing(null);
    form.resetFields();
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (modalMode === "create") {
        await UsersApi.create({
          username: values.username!.trim(),
          displayName: values.displayName.trim(),
          password: values.password,
          role: values.role,
          status: "active",
          phone: values.phone?.trim() || null,
        });
        message.success(t("users.createSuccess"));
      } else if (editing) {
        await UsersApi.patch(editing.id, {
          displayName: values.displayName.trim(),
          role: values.role,
          phone: values.phone?.trim() || null,
        });
        message.success(t("users.updateSuccess"));
      }
      closeModal();
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(apiErrorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(row: UserRow) {
    if (row.id === currentUserId) return;
    setLoading(true);
    try {
      await UsersApi.remove(row.id);
      message.success(t("users.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }

  async function onToggleStatus(row: UserRow, checked: boolean) {
    const next = checked ? "active" : "disabled";
    try {
      await UsersApi.patch(row.id, { status: next });
      setItems((prev) =>
        prev.map((u) => (u.id === row.id ? { ...u, status: next } : u)),
      );
      message.success(t("users.updateSuccess"));
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  function openReset(row: UserRow) {
    setResetTarget(row);
    resetForm.setFieldsValue({ password: "123456" });
    setResetOpen(true);
  }

  function closeReset() {
    setResetOpen(false);
    setResetTarget(null);
    resetForm.resetFields();
  }

  async function onResetPassword() {
    if (!resetTarget) return;
    try {
      const values = await resetForm.validateFields();
      setResetSubmitting(true);
      await UsersApi.patch(resetTarget.id, { password: values.password });
      message.success(t("users.resetPasswordSuccess"));
      closeReset();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(apiErrorMessage(t, err));
    } finally {
      setResetSubmitting(false);
    }
  }

  async function onExport() {
    if (selectedRowKeys.length === 0) {
      message.warning(t("users.exportNoSelection"));
      return;
    }
    setLoading(true);
    try {
      await downloadExport(selectedRowKeys as number[], q || undefined);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }

  function openImport() {
    setImportFile(null);
    setImportOpen(true);
  }

  function closeImport() {
    setImportOpen(false);
    setImportFile(null);
  }

  async function onConfirmImport() {
    if (!importFile) {
      message.warning(t("users.importNoFile"));
      return;
    }
    setImportSubmitting(true);
    try {
      await UsersApi.importFile(importFile);
      message.success(t("users.importSuccess"));
      closeImport();
      if (page !== 1) setPage(1);
      else await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setImportSubmitting(false);
    }
  }

  async function onDownloadTemplate() {
    try {
      await downloadImportTemplate();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  const columns: ColumnsType<UserRow> = [
    {
      title: t("users.username"),
      dataIndex: "username",
      ellipsis: true,
    },
    {
      title: t("users.displayName"),
      dataIndex: "displayName",
      ellipsis: true,
    },
    {
      title: t("users.role"),
      dataIndex: "role",
      width: 110,
      render: (role: UserRow["role"]) =>
        role === "admin" ? (
          <Tag color="blue">{t("users.roleAdmin")}</Tag>
        ) : (
          <Tag>{t("users.roleUser")}</Tag>
        ),
    },
    {
      title: t("users.status"),
      dataIndex: "status",
      width: 110,
      render: (status: UserRow["status"], row) =>
        row.role === "user" ? (
          <Switch
            checked={status === "active"}
            checkedChildren={t("users.statusActive")}
            unCheckedChildren={t("users.statusDisabled")}
            onChange={(checked) => void onToggleStatus(row, checked)}
          />
        ) : status === "active" ? (
          <Tag color="success">{t("users.statusActive")}</Tag>
        ) : (
          <Tag color="error">{t("users.statusDisabled")}</Tag>
        ),
    },
    {
      title: t("users.phone"),
      dataIndex: "phone",
      width: 140,
      ellipsis: true,
      render: (phone: string | null) => phone || "—",
    },
    {
      title: t("users.createdAt"),
      dataIndex: "createdAt",
      width: 170,
      render: (v: string) => formatTime(v, localeTag),
    },
    {
      title: t("users.updatedAt"),
      dataIndex: "updatedAt",
      width: 170,
      render: (v: string) => formatTime(v, localeTag),
    },
    {
      title: t("users.actions"),
      key: "actions",
      width: 132,
      fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button
            type="text"
            icon={<EditOutlined />}
            aria-label={t("users.edit")}
            onClick={() => openEdit(row)}
          />
          <Button
            type="text"
            icon={<KeyOutlined />}
            aria-label={t("users.resetPassword")}
            onClick={() => openReset(row)}
          />
          {row.id !== currentUserId && (
            <Popconfirm
              title={t("users.confirmDelete", {
                name: row.displayName || row.username,
              })}
              okText={t("users.delete")}
              cancelText={t("common.cancel")}
              okButtonProps={{ danger: true }}
              onConfirm={() => void onDelete(row)}
            >
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                aria-label={t("users.delete")}
              />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const pagination: TablePaginationConfig = {
    current: page,
    pageSize,
    total,
    showSizeChanger: true,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    showTotal: (n) => t("users.total", { count: n }),
    onChange: (p, size) => {
      if (size !== pageSize) {
        setPage(1);
        setPageSize(size);
      } else {
        setPage(p);
      }
    },
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <Typography.Title level={3} style={{ margin: 0 }}>
          <Space size={8}>
            <TeamOutlined />
            {t("users.title")}
          </Space>
        </Typography.Title>
        <Space.Compact style={{ width: "min(100%, 28rem)" }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("users.searchPlaceholder")}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onPressEnter={() => {
              setPage(1);
              setQ(searchDraft.trim());
            }}
          />
          <Button
            type="primary"
            onClick={() => {
              setPage(1);
              setQ(searchDraft.trim());
            }}
          >
            {t("users.search")}
          </Button>
        </Space.Compact>
      </div>

      <Card
        className="admin-page-card"
        styles={{ body: { padding: 0 } }}
        title={
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              {t("users.create")}
            </Button>
            <Button
              icon={<ImportOutlined />}
              onClick={openImport}
            >
              {t("users.import")}
            </Button>
            <Button icon={<ExportOutlined />} onClick={() => void onExport()}>
              {t("users.export")}
            </Button>
          </Space>
        }
      >
        <Table<UserRow>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={pagination}
          scroll={{ x: 1100 }}
          size={isMobile ? "small" : "middle"}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys),
            preserveSelectedRowKeys: true,
          }}
        />
      </Card>

      <Modal
        open={resetOpen}
        title={t("users.resetPassword")}
        onCancel={closeReset}
        onOk={() => void onResetPassword()}
        confirmLoading={resetSubmitting}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnHidden
        centered
        width={isMobile ? "92%" : 440}
      >
        {resetTarget && (
          <Alert
            type="info"
            showIcon
            message={`${resetTarget.displayName || resetTarget.username} (${resetTarget.username})`}
            style={{ marginBottom: 16 }}
          />
        )}
        <Form
          form={resetForm}
          layout="vertical"
          requiredMark="optional"
          className="admin-antd-form"
        >
          <Form.Item
            name="password"
            label={t("users.password")}
            rules={[
              { required: true, message: t("users.passwordRequired") },
              { min: 6, max: 128 },
            ]}
          >
            <Input.Password autoComplete="new-password" autoFocus />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={importOpen}
        title={t("users.importTitle")}
        onCancel={closeImport}
        onOk={() => void onConfirmImport()}
        confirmLoading={importSubmitting}
        okText={t("users.import")}
        cancelText={t("common.cancel")}
        destroyOnHidden
        centered
        width={isMobile ? "92%" : 480}
      >
        <Upload.Dragger
          accept=".xls,.xlsx,.csv"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => {
            setImportFile(file);
            return false;
          }}
          fileList={importFile ? [{ uid: "-1", name: importFile.name } as UploadFile] : []}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{t("users.importDragHint")}</p>
        </Upload.Dragger>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span style={{ color: "rgba(0,0,0,0.45)", fontSize: 13 }}>
            {t("users.importDragSubHint")}
          </span>
          <Button
            type="link"
            size="small"
            icon={<DownloadOutlined />}
            onClick={() => void onDownloadTemplate()}
            style={{ padding: 0, height: "auto" }}
          >
            {t("users.downloadTemplate")}
          </Button>
        </div>
        {importFile && (
          <div
            style={{
              marginTop: 8,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: "rgba(0,0,0,0.04)",
              borderRadius: 6,
            }}
          >
            <PaperClipOutlined style={{ color: "rgba(0,0,0,0.45)" }} />
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 13,
              }}
            >
              {importFile.name}
            </span>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setImportFile(null)}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={modalOpen}
        title={modalMode === "create" ? t("users.create") : t("users.edit")}
        onCancel={closeModal}
        onOk={() => void onSubmit()}
        confirmLoading={submitting}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnHidden
        centered
        width={isMobile ? "92%" : 520}
      >
        <Form
          form={form}
          layout={isMobile ? "vertical" : "horizontal"}
          labelCol={isMobile ? undefined : { flex: "88px", style: { width: 88, maxWidth: 88 } }}
          wrapperCol={isMobile ? undefined : { flex: "auto", style: { minWidth: 0 } }}
          labelAlign="right"
          requiredMark
          className="admin-antd-form"
          style={{ marginTop: 4 }}
          colon={false}
        >
          {modalMode === "create" && (
            <Form.Item
              name="username"
              label={t("users.username")}
              rules={[
                { required: true, message: t("users.usernameRequired") },
                { min: 3, max: 64 },
              ]}
            >
              <Input autoComplete="off" autoFocus />
            </Form.Item>
          )}
          <Form.Item
            name="displayName"
            label={t("users.displayName")}
            rules={[
              { required: true, message: t("users.displayNameRequired") },
              { max: 64 },
            ]}
          >
            <Input autoFocus={modalMode === "edit"} />
          </Form.Item>
          {modalMode === "create" && (
            <>
              <Form.Item
                name="password"
                label={t("users.password")}
                rules={[
                  { required: true, message: t("users.passwordRequired") },
                  { min: 6, max: 128 },
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="passwordConfirm"
                label={t("users.passwordConfirm")}
                dependencies={["password"]}
                rules={[
                  { required: true, message: t("users.passwordConfirmRequired") },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (value !== getFieldValue("password")) {
                        return Promise.reject(
                          new Error(t("users.passwordMismatch")),
                        );
                      }
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </>
          )}
          <Form.Item name="phone" label={t("users.phone")} rules={[{ max: 32 }]}>
            <Input type="tel" />
          </Form.Item>
          <Form.Item
            name="role"
            label={t("users.role")}
            rules={[{ required: true }]}
          >
            <Select
              options={[
                { value: "user", label: t("users.roleUser") },
                { value: "admin", label: t("users.roleAdmin") },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export function UsersPage() {
  return <UsersPageInner />;
}
