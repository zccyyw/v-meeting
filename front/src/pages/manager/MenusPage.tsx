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
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { SysMenuApi, type MenuItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

type FormValues = {
  parentId: number;
  menuType: "M" | "C" | "F";
  menuName: string;
  orderNum: number;
  path: string;
  component: string;
  query: string;
  routeName: string;
  isFrame: boolean;
  isCache: boolean;
  visible: "0" | "1";
  status: "0" | "1";
  perms: string;
  icon: string;
  remark: string;
};

const menuTypeLabel: Record<string, string> = { M: "dir", C: "menu", F: "button" };
const menuTypeColor: Record<string, string> = { M: "blue", C: "green", F: "orange" };

export function MenusPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [searchName, setSearchName] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysMenuApi.list({ menuName: searchName || undefined });
      setItems(res.items);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [searchName, t, message]);

  useEffect(() => { void load(); }, [load]);

  function openCreate(parent?: MenuItem) {
    setModalMode("create");
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      parentId: parent?.menuId ?? 0,
      menuType: parent ? "C" : "M",
      orderNum: 0,
      path: "", component: "", query: "", routeName: "",
      isFrame: false, isCache: true,
      visible: "0", status: "0",
      perms: "", icon: "#", remark: "",
    });
    setModalOpen(true);
  }

  function openEdit(row: MenuItem) {
    setModalMode("edit");
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      parentId: row.parentId,
      menuType: row.menuType,
      menuName: row.menuName,
      orderNum: row.orderNum,
      path: row.path,
      component: row.component,
      query: row.query,
      routeName: row.routeName,
      isFrame: row.isFrame,
      isCache: row.isCache,
      visible: row.visible as "0" | "1",
      status: row.status as "0" | "1",
      perms: row.perms,
      icon: row.icon,
      remark: row.remark,
    });
    setModalOpen(true);
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (modalMode === "create") {
        await SysMenuApi.create(values);
        message.success(t("common.createSuccess"));
      } else if (editing) {
        await SysMenuApi.patch(editing.menuId, values);
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

  async function onDelete(row: MenuItem) {
    try {
      await SysMenuApi.remove(row.menuId);
      message.success(t("common.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  // 构建树形表格数据
  function buildTreeData(flatItems: MenuItem[], parentId = 0): MenuItem[] {
    return flatItems
      .filter((item) => item.parentId === parentId)
      .map((item) => ({
        ...item,
        children: buildTreeData(flatItems, item.menuId).length > 0
          ? buildTreeData(flatItems, item.menuId)
          : undefined,
      }))
      .sort((a, b) => a.orderNum - b.orderNum);
  }

  const treeData = buildTreeData(items);

  const columns: ColumnsType<MenuItem> = [
    { title: t("menu.menuName"), dataIndex: "menuName", width: 200, ellipsis: true },
    {
      title: t("menu.menuType"), dataIndex: "menuType", width: 80,
      render: (v: string) => <Tag color={menuTypeColor[v]}>{t(`menu.type.${menuTypeLabel[v]}`)}</Tag>,
    },
    { title: t("menu.icon"), dataIndex: "icon", width: 60, render: (v: string) => v || "—" },
    { title: t("menu.path"), dataIndex: "path", width: 140, ellipsis: true, render: (v: string) => v || "—" },
    { title: t("menu.component"), dataIndex: "component", width: 180, ellipsis: true, render: (v: string) => v || "—" },
    { title: t("menu.perms"), dataIndex: "perms", width: 180, ellipsis: true, render: (v: string) => v || "—" },
    { title: t("menu.orderNum"), dataIndex: "orderNum", width: 70 },
    {
      title: t("menu.status"), dataIndex: "status", width: 70,
      render: (s: string) => s === "0" ? <Tag color="success">{t("menu.normal")}</Tag> : <Tag color="error">{t("menu.disabled")}</Tag>,
    },
    {
      title: t("common.actions"), key: "actions", width: 120, fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button type="text" icon={<PlusOutlined />} onClick={() => openCreate(row)} title={t("menu.addChild")} />
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm title={t("menu.confirmDelete", { name: row.menuName })} onConfirm={() => void onDelete(row)} okButtonProps={{ danger: true }}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <Typography.Title level={3} style={{ margin: 0 }}>{t("menu.title")}</Typography.Title>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("menu.searchPlaceholder")}
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

      <Table<MenuItem>
        rowKey="menuId"
        loading={loading}
        columns={columns}
        dataSource={treeData}
        pagination={false}
        scroll={{ x: 1100 }}
        expandable={{ defaultExpandAllRows: false }}
      />

      <Modal
        open={modalOpen}
        title={modalMode === "create" ? t("menu.create") : t("menu.edit")}
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
          <Form.Item name="parentId" label={t("menu.parentMenu")}>
            <Select options={[
              { value: 0, label: t("menu.root") },
              ...items.filter((m) => m.menuType === "M" || m.menuType === "C")
                .map((m) => ({ value: m.menuId, label: m.menuName })),
            ]} />
          </Form.Item>
          <Form.Item name="menuType" label={t("menu.menuType")}>
            <Radio.Group>
              <Radio.Button value="M">{t("menu.type.dir")}</Radio.Button>
              <Radio.Button value="C">{t("menu.type.menu")}</Radio.Button>
              <Radio.Button value="F">{t("menu.type.button")}</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="menuName" label={t("menu.menuName")} rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="orderNum" label={t("menu.orderNum")}>
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="path" label={t("menu.path")}>
            <Input />
          </Form.Item>
          <Form.Item name="component" label={t("menu.component")}>
            <Input />
          </Form.Item>
          <Form.Item name="perms" label={t("menu.perms")}>
            <Input placeholder="如 system:user:list" />
          </Form.Item>
          <Form.Item name="icon" label={t("menu.icon")}>
            <Input placeholder="如 user, tree-table, #" />
          </Form.Item>
          <Form.Item name="query" label={t("menu.query")}>
            <Input />
          </Form.Item>
          <Form.Item name="routeName" label={t("menu.routeName")}>
            <Input />
          </Form.Item>
          <Space>
            <Form.Item name="isFrame" label={t("menu.isFrame")} valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="isCache" label={t("menu.isCache")} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="visible" label={t("menu.visible")}>
            <Select options={[{ value: "0", label: t("menu.show") }, { value: "1", label: t("menu.hide") }]} />
          </Form.Item>
          <Form.Item name="status" label={t("menu.status")}>
            <Select options={[{ value: "0", label: t("menu.normal") }, { value: "1", label: t("menu.disabled") }]} />
          </Form.Item>
          <Form.Item name="remark" label={t("menu.remark")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
