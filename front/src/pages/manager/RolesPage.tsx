import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
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
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { indexColumn } from "@/components/indexColumn";
import { SysRoleApi, type RoleItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

type FormValues = {
  roleName: string;
  roleKey: string;
  roleSort: number;
  remark: string;
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
  const [checkedMenuKeys, setCheckedMenuKeys] = useState<number[]>([]);
  const [togglingId, setTogglingId] = useState<number | null>(null);

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
    // status 由列表开关管理（默认启用）；dataScope 数据范围暂未生效，隐藏后由后端默认"全部"
    form.setFieldsValue({ roleSort: 0, remark: "" });
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
        remark: detail.remark,
      });
      setCheckedMenuKeys(detail.menuIds);
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
      // 不提交 status：状态由列表开关单独管理，避免整表单提交时意外覆盖
      const body = { ...values, menuIds: [...checkedMenuKeys] };
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

  // 列表状态开关：直接启用/停用角色（roleId=1 系统管理员不允许停用）
  async function onToggleStatus(row: RoleItem, next: "0" | "1") {
    setTogglingId(row.roleId);
    try {
      await SysRoleApi.patch(row.roleId, { status: next });
      message.success(t(next === "0" ? "role.enableSuccess" : "role.disableSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setTogglingId(null);
    }
  }

  const columns: ColumnsType<RoleItem> = [
    indexColumn<RoleItem>(page, pageSize, { title: t("common.index") }),
    { title: t("role.roleName"), dataIndex: "roleName", ellipsis: true },
    {
      title: t("role.roleKey"), dataIndex: "roleKey", width: 140,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: t("role.roleSort"), dataIndex: "roleSort", width: 80 },
    {
      title: t("role.status"), dataIndex: "status", width: 90,
      // 直接开关启用/停用；系统管理员角色（roleId=1）禁用，不允许停用
      render: (s: string, row) => (
        <Popconfirm
          title={t(s === "0" ? "role.confirmDisable" : "role.confirmEnable", { name: row.roleName })}
          onConfirm={() => void onToggleStatus(row, s === "0" ? "1" : "0")}
          okButtonProps={s === "0" ? { danger: true } : undefined}
          disabled={row.roleId === 1 || togglingId === row.roleId}
        >
          <Switch
            size="small"
            checked={s === "0"}
            checkedChildren={t("role.normal")}
            unCheckedChildren={t("role.disabled")}
            loading={togglingId === row.roleId}
            disabled={row.roleId === 1}
          />
        </Popconfirm>
      ),
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
    showTotal: (n) => t("common.totalItems", { count: n }),
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
        width={720}
      >
        <Form form={form} layout="vertical" requiredMark>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="roleName" label={t("role.roleName")} rules={[{ required: true }]}>
                <Input autoFocus />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="roleKey" label={t("role.roleKey")} rules={[{ required: true }]}>
                <Input disabled={modalMode === "edit" && editing?.roleId === 1} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="roleSort" label={t("role.roleSort")}>
                <InputNumber min={0} controls={true} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label={t("role.menuPermissions")}>
            <div style={{ maxHeight: 240, overflow: "auto", border: "1px solid #d9d9d9", borderRadius: 6, padding: 8 }}>
              {/* 后端 menu-treeselect 节点字段为 id/label，映射为 Tree 的 key/title */}
              <Tree
                checkable
                defaultExpandAll
                fieldNames={{ key: "id", title: "label" }}
                checkedKeys={checkedMenuKeys}
                onCheck={(keys) => {
                  const arr = Array.isArray(keys) ? keys : keys.checked;
                  setCheckedMenuKeys((arr as (number | string)[]).map(Number));
                }}
                treeData={menuTree as never}
              />
            </div>
          </Form.Item>
          {/* 备注置于表单最底部 */}
          <Form.Item name="remark" label={t("role.remark")} style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
