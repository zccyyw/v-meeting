import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
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
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { SysConfigApi, type ConfigItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

type FormValues = {
  configName: string;
  configKey: string;
  configValue: string;
  configType: "Y" | "N";
  remark: string;
};

export function ConfigsPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [searchName, setSearchName] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [searchType, setSearchType] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<ConfigItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysConfigApi.list({
        configName: searchName || undefined,
        configKey: searchKey || undefined,
        configType: searchType || undefined,
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
  }, [searchName, searchKey, searchType, page, pageSize, t, message]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setModalMode("create");
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ configType: "N", configValue: "", remark: "" });
    setModalOpen(true);
  }

  function openEdit(row: ConfigItem) {
    setModalMode("edit");
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      configName: row.configName,
      configKey: row.configKey,
      configValue: row.configValue,
      configType: row.configType as "Y" | "N",
      remark: row.remark,
    });
    setModalOpen(true);
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (modalMode === "create") {
        await SysConfigApi.create(values);
        message.success(t("common.createSuccess"));
      } else if (editing) {
        const { configKey: _k, ...rest } = values;
        await SysConfigApi.patch(editing.configId, rest);
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

  async function onDelete(row: ConfigItem) {
    try {
      await SysConfigApi.remove(row.configId);
      message.success(t("common.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  const columns: ColumnsType<ConfigItem> = [
    { title: t("config.name"), dataIndex: "configName", ellipsis: true },
    { title: t("config.key"), dataIndex: "configKey", width: 200, ellipsis: true },
    { title: t("config.value"), dataIndex: "configValue", width: 200, ellipsis: true },
    {
      title: t("config.type"), dataIndex: "configType", width: 80,
      render: (v: string) => v === "Y"
        ? <Tag color="success">{t("config.typeBuiltIn")}</Tag>
        : <Tag>{t("config.typeCustom")}</Tag>,
    },
    { title: t("config.remark"), dataIndex: "remark", ellipsis: true, render: (v: string) => v || "—" },
    { title: t("config.createTime"), dataIndex: "createTime", width: 170, render: (v: string) => v },
    {
      title: t("common.actions"), key: "actions", width: 100, fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm title={t("config.confirmDelete")} onConfirm={() => void onDelete(row)} okButtonProps={{ danger: true }}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
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
        <Typography.Title level={3} style={{ margin: 0 }}>{t("config.title")}</Typography.Title>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("config.name")}
            value={searchName}
            onChange={(e) => setSearchName(e.target.value)}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 160 }}
          />
          <Input
            allowClear
            placeholder={t("config.key")}
            value={searchKey}
            onChange={(e) => setSearchKey(e.target.value)}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 160 }}
          />
          <Select
            allowClear
            placeholder={t("config.type")}
            value={searchType || undefined}
            onChange={(v) => setSearchType(v ?? "")}
            style={{ width: 100 }}
            options={[
              { value: "Y", label: t("config.typeBuiltIn") },
              { value: "N", label: t("config.typeCustom") },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("common.create")}
          </Button>
        </Space>
      </div>

      <Table<ConfigItem>
        rowKey="configId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={pagination}
        scroll={{ x: 900 }}
      />

      <Modal
        open={modalOpen}
        title={modalMode === "create" ? t("config.create") : t("config.edit")}
        onCancel={() => setModalOpen(false)}
        onOk={() => void onSubmit()}
        confirmLoading={submitting}
        okText={t("common.save")}
        cancelText={t("common.cancel")}
        destroyOnHidden
        centered
        width={520}
      >
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item name="configName" label={t("config.name")} rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="configKey" label={t("config.key")} rules={[{ required: true }]}>
            <Input disabled={modalMode === "edit"} />
          </Form.Item>
          <Form.Item name="configValue" label={t("config.value")}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="configType" label={t("config.type")}>
            <Select options={[
              { value: "Y", label: t("config.typeBuiltIn") },
              { value: "N", label: t("config.typeCustom") },
            ]} />
          </Form.Item>
          <Form.Item name="remark" label={t("config.remark")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
