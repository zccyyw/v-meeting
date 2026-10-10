import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tree,
  Typography,
  Upload,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  KeyOutlined,
  SearchOutlined,
  TeamOutlined,
  ExportOutlined,
  UploadOutlined,
  DownloadOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { DataNode } from "antd/es/tree";
import {
  SysUserApi,
  SysDeptApi,
  type SysUserItem,
  type DeptItem,
  type SysUserImportMode,
  type SysUserImportResult,
} from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";
import { getUserId, hasPermission } from "@/auth/session";
import { PasswordStrengthHint } from "@/components/PasswordStrengthHint";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

type FormValues = {
  deptId: number | null;
  userName?: string;
  nickName: string;
  password?: string;
  passwordConfirm?: string;
  email: string;
  phonenumber: string;
  sex: "0" | "1" | "2";
  status: "0" | "1";
  remark: string;
  roleIds: number[];
};

type RoleOption = { value: number; label: string };

function formatTime(iso: string, localeTag: string): string {
  try { return new Date(iso).toLocaleString(localeTag); }
  catch { return iso; }
}

export function UsersPage() {
  const { t, i18n } = useTranslation();
  const { message, modal } = AntApp.useApp();
  const localeTag = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  const currentUserId = getUserId();

  // ── 列表状—?──
  const [items, setItems] = useState<SysUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);

  // ── 搜索 ──
  const [searchName, setSearchName] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);

  // ── 部门—?──
  const [deptTree, setDeptTree] = useState<DeptItem[]>([]);
  const [deptLoading, setDeptLoading] = useState(false);

  // ── 角色选项 ──
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);

  // ── Modal ──
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<SysUserItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  // ── 重置密码 Modal ──
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<SysUserItem | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetForm] = Form.useForm<{ password: string }>();

  // ── 导入 / 导出 ──
  // 默认「最小化」模式：只需账号+昵称，角色默认普通用户、密码默认 123456
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<SysUserImportMode>("simple");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importSubmitting, setImportSubmitting] = useState(false);
  const [importResult, setImportResult] = useState<SysUserImportResult | null>(null);
  const [exporting, setExporting] = useState(false);

  // 勾选导出：selectedUserIds 为跨页累积勾选的账号 id；
  // selectAllUsers 为「选择全部 N 个用户」模式（此时忽略 ids，按全部用户导出）
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [selectAllUsers, setSelectAllUsers] = useState(false);
  // 标记刚点击过「选择全部」，用于区分 antd 随之触发的 onChange 与用户手动勾选
  const allSelectModeRef = useRef(false);

  const openImport = () => {
    setImportOpen(true);
    setImportMode("simple");
    setImportFile(null);
    setImportResult(null);
  };

  const closeImport = () => {
    setImportOpen(false);
    setImportFile(null);
    setImportResult(null);
  };

  /**
   * 导出：仅导出勾选的用户
   * - 勾选若干账号 → 导出这些账号（支持跨页累积勾选）
   * - 勾选「选择全部 N 个用户」→ 导出全部未删除用户（带当前搜索条件时按条件全量导出）
   * - 未勾选任何账号 → 提示，不发起请求
   * 文件含密码哈希，导出前二次确认
   */
  const onExport = () => {
    const count = selectedUserIds.length;
    if (!selectAllUsers && count === 0) {
      message.warning(t("users.exportNoSelection"));
      return;
    }
    const keyword = searchName || searchPhone;
    modal.confirm({
      title: t("users.exportConfirmTitle"),
      content: (
        <div>
          <p>
            {selectAllUsers
              ? keyword
                ? t("users.exportScopeFiltered", { keyword })
                : t("users.exportScopeAll")
              : t("users.exportSelected", { count })}
          </p>
          <p style={{ color: "#cf1322" }}>{t("users.exportSensitiveWarn")}</p>
        </div>
      ),
      okText: t("users.export"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        setExporting(true);
        try {
          const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
          await SysUserApi.exportUsers(
            selectAllUsers ? { q: keyword || undefined } : { ids: selectedUserIds },
            `users-${stamp}.xlsx`,
          );
          message.success(t("users.exportSuccess"));
        } catch (err) {
          message.error(apiErrorMessage(t, err));
        } finally {
          setExporting(false);
        }
      },
    });
  };

  const onDownloadTemplate = async () => {
    try {
      await SysUserApi.downloadUserImportTemplate(importMode);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  };

  const onConfirmImport = async () => {
    if (!importFile) {
      message.warning(t("users.importNoFile"));
      return;
    }
    setImportSubmitting(true);
    try {
      const res = await SysUserApi.importUsers(importFile, importMode);
      setImportResult(res);
      message.success(t("users.importSuccess"));
      if (page !== 1) setPage(1);
      else await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setImportSubmitting(false);
    }
  };

  const loadDeptTree = useCallback(async () => {
    setDeptLoading(true);
    try {
      const res = await SysDeptApi.list();
      setDeptTree(res.tree);
    } catch { /* ignore */ } finally {
      setDeptLoading(false);
    }
  }, []);

  const loadRoles = useCallback(async () => {
    try {
      const roles = await SysUserApi.roles();
      setRoleOptions(roles.map((r) => ({ value: Number(r.role_id), label: r.role_name })));
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysUserApi.list({
        deptId: selectedDeptId ?? undefined,
        userName: searchName || undefined,
        phonenumber: searchPhone || undefined,
        status: searchStatus || undefined,
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
  }, [selectedDeptId, searchName, searchPhone, searchStatus, page, pageSize, t, message]);

  useEffect(() => { void loadDeptTree(); void loadRoles(); }, [loadDeptTree, loadRoles]);
  useEffect(() => { void load(); }, [load]);

  // ── 部门树数据转—?──
  function toTreeData(items: DeptItem[]): DataNode[] {
    return items.map((item) => ({
      key: item.deptId,
      title: item.deptName,
      children: item.children ? toTreeData(item.children) : undefined,
    }));
  }

  function openCreate() {
    setModalMode("create");
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      deptId: selectedDeptId,
      sex: "0",
      status: "0",
      email: "",
      phonenumber: "",
      remark: "",
      roleIds: [],
    });
    setModalOpen(true);
  }

  function openEdit(row: SysUserItem) {
    setModalMode("edit");
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      deptId: row.deptId,
      nickName: row.nickName,
      email: row.email,
      phonenumber: row.phonenumber,
      sex: row.sex as "0" | "1" | "2",
      status: row.status as "0" | "1",
      remark: row.remark,
      roleIds: row.roleIds,
    });
    setModalOpen(true);
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (modalMode === "create") {
        await SysUserApi.create({
          ...values,
          password: values.password,
        });
        message.success(t("common.createSuccess"));
      } else if (editing) {
        const { password: _pw, passwordConfirm: _pwc, userName: _un, ...rest } = values;
        await SysUserApi.patch(editing.userId, rest);
        message.success(t("common.updateSuccess"));
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(apiErrorMessage(t, err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(row: SysUserItem) {
    if (row.userId === currentUserId) return;
    try {
      await SysUserApi.remove(row.userId);
      message.success(t("common.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  async function onToggleStatus(row: SysUserItem, checked: boolean) {
    const next = checked ? "0" : "1";
    try {
      await SysUserApi.changeStatus(row.userId, next);
      setItems((prev) => prev.map((u) => u.userId === row.userId ? { ...u, status: next } : u));
      message.success(t("common.updateSuccess"));
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  function openReset(row: SysUserItem) {
    setResetTarget(row);
    resetForm.setFieldsValue({ password: "123456" });
    setResetOpen(true);
  }

  async function onResetPassword() {
    if (!resetTarget) return;
    try {
      const values = await resetForm.validateFields();
      setResetSubmitting(true);
      await SysUserApi.resetPwd(resetTarget.userId, values.password);
      message.success(t("users.resetPasswordSuccess"));
      setResetOpen(false);
    } catch (err) {
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(apiErrorMessage(t, err));
    } finally {
      setResetSubmitting(false);
    }
  }

  const columns: ColumnsType<SysUserItem> = [
    { title: t("users.username"), dataIndex: "userName", ellipsis: true },
    { title: t("users.displayName"), dataIndex: "nickName", ellipsis: true },
    {
      title: t("users.dept"), dataIndex: "deptId", width: 120, ellipsis: true,
      render: (deptId: number | null) => {
        const dept = deptTree.find((d) => d.deptId === deptId);
        return dept ? dept.deptName : "—";
      },
    },
    {
      title: t("users.roles"), dataIndex: "roleIds", width: 140,
      render: (ids: number[]) => ids.map((id) => {
        const role = roleOptions.find((r) => r.value === id);
        return role ? <Tag key={id} color={id === 1 ? "blue" : undefined}>{role.label}</Tag> : null;
      }),
    },
    {
      title: t("users.status"), dataIndex: "status", width: 100,
      render: (status: string, row) =>
        row.userId !== 1 ? (
          <Switch
            checked={status === "0"}
            checkedChildren={t("users.statusActive")}
            unCheckedChildren={t("users.statusDisabled")}
            onChange={(checked) => void onToggleStatus(row, checked)}
          />
        ) : status === "0" ? <Tag color="success">{t("users.statusActive")}</Tag> : <Tag color="error">{t("users.statusDisabled")}</Tag>,
    },
    { title: t("users.phone"), dataIndex: "phonenumber", width: 130, render: (v: string) => v || "—" },
    { title: t("users.createdAt"), dataIndex: "createTime", width: 170, render: (v: string) => formatTime(v, localeTag) },
    {
      title: t("common.actions"), key: "actions", width: 132, fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          {hasPermission("system:user:edit") && (
            <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} aria-label={t("common.edit")} />
          )}
          {hasPermission("system:user:resetPwd") && (
            <Button type="text" icon={<KeyOutlined />} onClick={() => openReset(row)} aria-label={t("users.resetPassword")} />
          )}
          {hasPermission("system:user:remove") && row.userId !== currentUserId && (
            <Popconfirm
              title={t("users.confirmDelete", { name: row.nickName || row.userName })}
              okText={t("common.delete")}
              cancelText={t("common.cancel")}
              okButtonProps={{ danger: true }}
              onConfirm={() => void onDelete(row)}
            >
              <Button type="text" danger icon={<DeleteOutlined />} aria-label={t("common.delete")} />
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
      if (size !== pageSize) { setPage(1); setPageSize(size); } else { setPage(p); }
    },
  };

  return (
    <div style={{ display: "flex", gap: 16 }}>
      {/* 部门—?*/}
      <Card
        size="small"
        style={{ width: 240, flexShrink: 0 }}
        title={t("dept.title")}
        loading={deptLoading}
      >
        <Tree
          treeData={toTreeData(deptTree)}
          defaultExpandAll
          selectedKeys={selectedDeptId ? [selectedDeptId] : []}
          onSelect={(keys) => {
            setSelectedDeptId(keys[0] ? Number(keys[0]) : null);
            setPage(1);
          }}
        />
      </Card>

      {/* 用户列表 */}
      <div className="admin-page" style={{ flex: 1, minWidth: 0 }}>
        <div className="admin-page-header">
          <Typography.Title level={3} style={{ margin: 0 }}>
            <Space size={8}><TeamOutlined />{t("users.title")}</Space>
          </Typography.Title>
          <Space>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder={t("users.username")}
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onPressEnter={() => { setPage(1); void load(); }}
              style={{ width: 140 }}
            />
            <Input
              allowClear
              placeholder={t("users.phone")}
              value={searchPhone}
              onChange={(e) => setSearchPhone(e.target.value)}
              onPressEnter={() => { setPage(1); void load(); }}
              style={{ width: 130 }}
            />
            <Select
              allowClear
              placeholder={t("users.status")}
              value={searchStatus || undefined}
              onChange={(v) => setSearchStatus(v ?? "")}
              style={{ width: 100 }}
              options={[
                { value: "0", label: t("users.statusActive") },
                { value: "1", label: t("users.statusDisabled") },
              ]}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); void load(); }}>
              {t("users.search")}
            </Button>
            {hasPermission("system:user:add") && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                {t("users.create")}
              </Button>
            )}
            {hasPermission("system:user:export") && (
              <Button icon={<ExportOutlined />} loading={exporting} onClick={onExport}>
                {t("users.export")}
              </Button>
            )}
            {hasPermission("system:user:import") && (
              <Button icon={<UploadOutlined />} onClick={openImport}>
                {t("users.import")}
              </Button>
            )}
          </Space>
        </div>

        <Table<SysUserItem>
          rowKey="userId"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={pagination}
          scroll={{ x: 1100 }}
          rowSelection={{
            // 跨页累积勾选，导出时按 id 列表导出
            preserveSelectedRowKeys: true,
            selectedRowKeys: selectedUserIds,
            selections: [
              {
                key: "all",
                text: t("users.selectAllUsers", { total }),
                // antd 6 的自定义选项回调是 onSelect（onClick 已被移除，写 onClick 会被静默忽略）
                onSelect: (currentRowKeys) => {
                  // 标记「全选模式」：点击该选项后 antd 可能紧接触发一次 onChange，
                  // 靠此标记避免被当成手动勾选而退出全选模式
                  allSelectModeRef.current = true;
                  setSelectAllUsers(true);
                  setSelectedUserIds(currentRowKeys.map((k) => Number(k)));
                  // 若本次没有触发 onChange，下一轮事件循环也要解除标记，
                  // 否则下一次手动勾选会被误当作全选流程而被忽略
                  window.setTimeout(() => {
                    allSelectModeRef.current = false;
                  }, 0);
                },
              },
            ],
            onChange: (keys) => {
              const ids = (keys as number[]).map((k) => Number(k));
              setSelectedUserIds(ids);
              if (allSelectModeRef.current) {
                allSelectModeRef.current = false;
                return; // 保持「全部用户」模式
              }
              // 手动勾选/取消（含表头当前页全选）即退出「全部」模式
              setSelectAllUsers(false);
            },
          }}
        />
      </div>

      {/* 重置密码 Modal */}
      <Modal
        open={resetOpen}
        title={t("users.resetPassword")}
        onCancel={() => setResetOpen(false)}
        onOk={() => void onResetPassword()}
        confirmLoading={resetSubmitting}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnHidden
        centered
        width={440}
      >
        {resetTarget && (
          <p style={{ marginBottom: 16 }}>
            <strong>{resetTarget.nickName || resetTarget.userName}</strong> ({resetTarget.userName})
          </p>
        )}
        <Form form={resetForm} layout="vertical">
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
          <Form.Item shouldUpdate>
            {({ getFieldValue }) => (
              <PasswordStrengthHint password={getFieldValue("password") || ""} />
            )}
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入 Modal */}
      <Modal
        open={importOpen}
        title={t("users.import")}
        onCancel={closeImport}
        onOk={() => void onConfirmImport()}
        confirmLoading={importSubmitting}
        okText={t("users.importStart")}
        cancelText={t("common.close")}
        okButtonProps={{ disabled: !importFile }}
        destroyOnHidden
        centered
        width={640}
      >
        <Radio.Group
          value={importMode}
          onChange={(e) => {
            setImportMode(e.target.value as SysUserImportMode);
            setImportResult(null);
          }}
        >
          <Space direction="vertical" size={4}>
            <Radio value="simple">{t("users.importModeSimple")}</Radio>
            <Typography.Paragraph type="secondary" style={{ margin: "0 0 0 24px", fontSize: 12 }}>
              {t("users.importModeSimpleDesc")}
            </Typography.Paragraph>
            <Radio value="full">{t("users.importModeFull")}</Radio>
            <Typography.Paragraph type="secondary" style={{ margin: "0 0 0 24px", fontSize: 12 }}>
              {t("users.importModeFullDesc")}
            </Typography.Paragraph>
          </Space>
        </Radio.Group>

        <Upload.Dragger
          accept=".xlsx"
          maxCount={1}
          beforeUpload={(file) => {
            setImportFile(file);
            setImportResult(null);
            return false;
          }}
          onRemove={() => {
            setImportFile(null);
            return true;
          }}
          fileList={importFile ? [{ uid: "-1", name: importFile.name } as UploadFile] : []}
          style={{ marginTop: 12 }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">{t("users.importDragHint")}</p>
        </Upload.Dragger>

        <Button
          type="link"
          size="small"
          icon={<DownloadOutlined />}
          style={{ paddingLeft: 0 }}
          onClick={() => void onDownloadTemplate()}
        >
          {t("users.importTemplate")}
        </Button>

        {importResult && (
          <div style={{ marginTop: 12, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
            <Space size={16} wrap>
              <Typography.Text>
                {t("users.importTotal")}: <strong>{importResult.total}</strong>
              </Typography.Text>
              <Typography.Text type="success">
                {t("users.importCreated")}: <strong>{importResult.created}</strong>
              </Typography.Text>
              <Typography.Text type="warning">
                {t("users.importUpdated")}: <strong>{importResult.updated}</strong>
              </Typography.Text>
              {importResult.failed.length > 0 && (
                <Typography.Text type="danger">
                  {t("users.importFailed")}: <strong>{importResult.failed.length}</strong>
                </Typography.Text>
              )}
            </Space>
            {importResult.defaultPasswordApplied > 0 && (
              <Typography.Paragraph type="warning" style={{ marginBottom: 4 }}>
                {t("users.importDefaultPwdWarn", {
                  count: importResult.defaultPasswordApplied,
                  password: importResult.defaultPassword,
                })}
              </Typography.Paragraph>
            )}
            {importResult.warnings.length > 0 && (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 4 }}>
                {t("users.importWarnings", { count: importResult.warnings.length })}
              </Typography.Paragraph>
            )}
            {importResult.failed.length > 0 && (
              <Table
                size="small"
                rowKey={(r) => `${r.row}`}
                pagination={false}
                scroll={{ y: 180 }}
                dataSource={importResult.failed}
                columns={[
                  { title: t("users.importRow"), dataIndex: "row", width: 70 },
                  { title: t("users.username"), dataIndex: "username", width: 140 },
                  { title: t("users.importReason"), dataIndex: "reason" },
                ]}
              />
            )}
          </div>
        )}
      </Modal>

      {/* 新增/编辑 Modal */}
      <Modal
        open={modalOpen}
        title={modalMode === "create" ? t("users.create") : t("users.edit")}
        onCancel={() => setModalOpen(false)}
        onOk={() => void onSubmit()}
        confirmLoading={submitting}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnHidden
        centered
        width={560}
      >
        <Form form={form} layout="vertical" requiredMark>
          {modalMode === "create" && (
            <Form.Item name="userName" label={t("users.username")} rules={[{ required: true }, { min: 3, max: 30 }]}>
              <Input autoComplete="off" autoFocus />
            </Form.Item>
          )}
          <Form.Item name="nickName" label={t("users.displayName")} rules={[{ required: true }, { max: 30 }]}>
            <Input autoFocus={modalMode === "edit"} />
          </Form.Item>
          {modalMode === "create" && (
            <>
              <Form.Item name="password" label={t("users.password")} rules={[{ required: true }, { min: 6, max: 128 }]}>
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item shouldUpdate>
                {({ getFieldValue }) => (
                  <PasswordStrengthHint password={getFieldValue("password") || ""} />
                )}
              </Form.Item>
              <Form.Item
                name="passwordConfirm"
                label={t("users.passwordConfirm")}
                dependencies={["password"]}
                rules={[
                  { required: true, message: t("users.passwordConfirmRequired") },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (value !== getFieldValue("password")) return Promise.reject(new Error(t("users.passwordMismatch")));
                      return Promise.resolve();
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
            </>
          )}
          <Form.Item name="deptId" label={t("users.dept")}>
            <Select
              allowClear
              placeholder={t("users.selectDept")}
              options={[
                ...deptTree.map((d) => ({ value: d.deptId, label: d.deptName })),
              ]}
            />
          </Form.Item>
          <Form.Item name="roleIds" label={t("users.roles")}>
            <Select
              mode="multiple"
              placeholder={t("users.selectRoles")}
              options={roleOptions}
            />
          </Form.Item>
          <Form.Item name="phonenumber" label={t("users.phone")} rules={[{ max: 11 }]}>
            <Input type="tel" />
          </Form.Item>
          <Form.Item name="email" label={t("users.email")} rules={[{ max: 50, type: "email" }]}>
            <Input type="email" />
          </Form.Item>
          <Form.Item name="sex" label={t("users.sex")}>
            <Select options={[
              { value: "0", label: t("users.sexMale") },
              { value: "1", label: t("users.sexFemale") },
              { value: "2", label: t("users.sexUnknown") },
            ]} />
          </Form.Item>
          <Form.Item name="status" label={t("users.status")}>
            <Select options={[
              { value: "0", label: t("users.statusActive") },
              { value: "1", label: t("users.statusDisabled") },
            ]} />
          </Form.Item>
          <Form.Item name="remark" label={t("users.remark")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
