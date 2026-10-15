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
  Typography,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { SysDeptApi, type DeptItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

type FormValues = {
  parentId: number;
  deptName: string;
  orderNum: number;
  leader: string;
  phone: string;
  email: string;
};

export function DeptsPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DeptItem[]>([]);
  const [searchName, setSearchName] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<DeptItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysDeptApi.list({ deptName: searchName || undefined });
      setItems(res.items);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [searchName, t, message]);

  useEffect(() => { void load(); }, [load]);

  function openCreate(parent?: DeptItem) {
    setModalMode("create");
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      parentId: parent?.deptId ?? 0,
      orderNum: 0,
      leader: "", phone: "", email: "",
    });
    setModalOpen(true);
  }

  function openEdit(row: DeptItem) {
    setModalMode("edit");
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      parentId: row.parentId,
      deptName: row.deptName,
      orderNum: row.orderNum,
      leader: row.leader,
      phone: row.phone,
      email: row.email,
    });
    setModalOpen(true);
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (modalMode === "create") {
        await SysDeptApi.create(values);
        message.success(t("common.createSuccess"));
      } else if (editing) {
        await SysDeptApi.patch(editing.deptId, values);
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

  async function onDelete(row: DeptItem) {
    try {
      await SysDeptApi.remove(row.deptId);
      message.success(t("common.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  // 列表状态开关：直接启用/停用部门（根部门 deptId=1 不允许停用）
  async function onToggleStatus(row: DeptItem, next: "0" | "1") {
    setTogglingId(row.deptId);
    try {
      await SysDeptApi.patch(row.deptId, { status: next });
      message.success(t(next === "0" ? "dept.enableSuccess" : "dept.disableSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setTogglingId(null);
    }
  }

  // 扁平表格—?
  const columns: ColumnsType<DeptItem> = [
    { title: t("dept.deptName"), dataIndex: "deptName", ellipsis: true },
    { title: t("dept.orderNum"), dataIndex: "orderNum", width: 80 },
    { title: t("dept.leader"), dataIndex: "leader", width: 120, render: (v: string) => v || "—" },
    { title: t("dept.phone"), dataIndex: "phone", width: 140, render: (v: string) => v || "—" },
    { title: t("dept.email"), dataIndex: "email", width: 180, render: (v: string) => v || "—" },
    {
      title: t("dept.status"), dataIndex: "status", width: 90,
      // 直接开关启用/停用（部门停用仅影响下拉展示过滤，均可操作）
      render: (s: string, row) => (
        <Popconfirm
          title={t(s === "0" ? "dept.confirmDisable" : "dept.confirmEnable", { name: row.deptName })}
          onConfirm={() => void onToggleStatus(row, s === "0" ? "1" : "0")}
          okButtonProps={s === "0" ? { danger: true } : undefined}
          disabled={togglingId === row.deptId}
        >
          <Switch
            size="small"
            checked={s === "0"}
            checkedChildren={t("dept.normal")}
            unCheckedChildren={t("dept.disabled")}
            loading={togglingId === row.deptId}
          />
        </Popconfirm>
      ),
    },
    {
      title: t("common.actions"), key: "actions", width: 120, fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button type="text" icon={<PlusOutlined />} onClick={() => openCreate(row)} title={t("dept.addChild")} />
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm title={t("dept.confirmDelete", { name: row.deptName })} onConfirm={() => void onDelete(row)} okButtonProps={{ danger: true }}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <Typography.Title level={3} style={{ margin: 0 }}>{t("dept.title")}</Typography.Title>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("dept.searchPlaceholder")}
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            onPressEnter={() => void load()}
            style={{ width: 220 }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
            {t("common.create")}
          </Button>
        </Space>
      </div>

      <Table<DeptItem>
        rowKey="deptId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={false}
        scroll={{ x: 900 }}
        rowClassName="editable-row"
      />

      <Modal
        open={modalOpen}
        title={modalMode === "create" ? t("dept.create") : t("dept.edit")}
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
              <Form.Item name="parentId" label={t("dept.parentDept")}>
                <Select
                  options={[
                    { value: 0, label: t("dept.root") },
                    ...items.map((d) => ({ value: d.deptId, label: d.deptName })),
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="deptName" label={t("dept.deptName")} rules={[{ required: true }]}>
                <Input autoFocus />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="orderNum" label={t("dept.orderNum")}>
                <InputNumber min={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="leader" label={t("dept.leader")}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label={t("dept.phone")}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label={t("dept.email")}>
                <Input />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
