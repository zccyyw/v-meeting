import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tree,
  Typography,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { SysRoleApi, type RoleItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

type FormValues = {
  roleName: string;
  roleKey: string;
  roleSort: number;
  dataScope: "1" | "2" | "3" | "4";
  status: "0" | "1";
  remark: string;
  menuIds: number[];
};

export function RolesPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<RoleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchName, setSearchName] = useState("");
  const [searchStatus, setSearchStatus] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [menuTree, setMenuTree] = useState<{ id: number; label: string; children?: unknown[] }[]>([]);
  const [checkedMenuKeys, setCheckedMenuKeys] = useState<React.Key[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysRoleApi.list({
        roleName: searchName || undefined,
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
  }, [searchName, searchStatus, page, pageSize, t, message]);

  useEffect(() => { void load(); }, [load]);

  async function loadMenuTree() {
    try {
      const tree = await SysRoleApi.menuTreeSelect();
      setMenuTree(tree);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  async function openCreate() {
    setModalMode("create");
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ roleSort: 0, dataScope: "1", status: "0", remark: "", menuIds: [] });
    setCheckedMenuKeys([]);
    await loadMenuTree();
    setModalOpen(true);
  }

  async function openEdit(row: RoleItem) {
    setModalMode("edit");
    setEditing(row);
    form.resetFields();
    try {
      const detail = await SysRoleApi.get(row.roleId);
      form.setFieldsValue({
        roleName: detail.roleName,
        roleKey: detail.roleKey,
        roleSort: detail.roleSort,
        dataScope: detail.dataScope as "1" | "2" | "3" | "4",
        status: detail.status as "0" | "1",
        remark: detail.remark,
        menuIds: detail.menuIds,
      });
      setCheckedMenuKeys(detail.menuIds.map(String));
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
    await loadMenuTree();
    setModalOpen(true);
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const body = { ...values, menuIds: checkedMenuKeys.map(Number) };
      if (modalMode === "create") {
        await SysRoleApi.create(body);
        message.success(t("common.createSuccess"));
      } else if (editing) {
        await SysRoleApi.patch(editing.roleId, body);
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

  async function onDelete(row: RoleItem) {
    try {
      await SysRoleApi.remove(row.roleId);
      message.success(t("common.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  const columns: ColumnsType<RoleItem> = [
    { title: t("role.roleName"), dataIndex: "roleName", ellipsis: true },
    {
      title: t("role.roleKey"), dataIndex: "roleKey", width: 140,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: t("role.roleSort"), dataIndex: "roleSort", width: 80 },
    {
      title: t("role.status"), dataIndex: "status", width: 80,
      render: (s: string) => s === "0" ? <Tag color="success">{t("role.normal")}</Tag> : <Tag color="error">{t("role.disabled")}</Tag>,
    },
    { title: t("role.remark"), dataIndex: "remark", ellipsis: true, render: (v: string) => v || "—" },
    {
      title: t("common.actions"), key: "actions", width: 100, fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          {row.roleId !== 1 && (
            <Button type="text" icon={<EditOutlined />} onClick={() => void openEdit(row)} />
          )}
          {row.roleId !== 1 && (
            <Popconfirm title={t("role.confirmDelete", { name: row.roleName })} onConfirm={() => void onDelete(row)} okButtonProps={{ danger: true }}>
              <Button type="text" danger icon={<DeleteOutlined />} />
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
    onChange: (p, size) => {
      if (size !== pageSize) { setPage(1); setPageSize(size); } else { setPage(p); }
    },
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <Typography.Title level={3} style={{ margin: 0 }}>{t("role.title")}</Typography.Title>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("role.searchPlaceholder")}
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 200 }}
          />
          <Select
            allowClear
            placeholder={t("role.status")}
            value={searchStatus || undefined}
            onChange={(v) => setSearchStatus(v ?? "")}
            style={{ width: 120 }}
            options={[{ value: "0", label: t("role.normal") }, { value: "1", label: t("role.disabled") }]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => void openCreate()}>
            {t("common.create")}
          </Button>
        </Space>
      </div>

      <Table<RoleItem>
        rowKey="roleId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={pagination}
        scroll={{ x: 700 }}
      />

      <Modal
        open={modalOpen}
        title={modalMode === "create" ? t("role.create") : t("role.edit")}
        onCancel={() => setModalOpen(false)}
        onOk={() => void onSubmit()}
        confirmLoading={submitting}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnHidden
        centered
        width={600}
      >
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item name="roleName" label={t("role.roleName")} rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="roleKey" label={t("role.roleKey")} rules={[{ required: true }]}>
            <Input disabled={modalMode === "edit" && editing?.roleId === 1} />
          </Form.Item>
          <Form.Item name="roleSort" label={t("role.roleSort")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="dataScope" label={t("role.dataScope")}>
            <Select options={[
              { value: "1", label: t("role.dataScopeAll") },
              { value: "2", label: t("role.dataScopeCustom") },
              { value: "3", label: t("role.dataScopeDept") },
              { value: "4", label: t("role.dataScopeDeptAndBelow") },
            ]} />
          </Form.Item>
          <Form.Item name="status" label={t("role.status")}>
            <Select options={[{ value: "0", label: t("role.normal") }, { value: "1", label: t("role.disabled") }]} />
          </Form.Item>
          <Form.Item name="remark" label={t("role.remark")}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item label={t("role.menuPermissions")}>
            <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid #d9d9d9", borderRadius: 6, padding: 8 }}>
              <Tree
                checkable
                defaultExpandAll
                checkedKeys={checkedMenuKeys}
                onCheck={(keys) => setCheckedMenuKeys(keys as React.Key[])}
                treeData={menuTree as never}
              />
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
