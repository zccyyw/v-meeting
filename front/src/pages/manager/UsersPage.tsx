import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
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
  Tree,
  Typography,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  KeyOutlined,
  SearchOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { DataNode } from "antd/es/tree";
import {
  SysUserApi,
  SysDeptApi,
  type SysUserItem,
  type DeptItem,
} from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";
import { getUserId, hasPermission } from "@/auth/session";

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
  const { message } = AntApp.useApp();
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
          </Space>
        </div>

        <Table<SysUserItem>
          rowKey="userId"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={pagination}
          scroll={{ x: 1100 }}
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
        </Form>
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
