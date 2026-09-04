import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
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
import { SysNoticeApi, type NoticeItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

type FormValues = {
  noticeTitle: string;
  noticeType: "1" | "2";
  noticeContent: string;
  status: "0" | "1";
  remark: string;
};

export function NoticesPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NoticeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [searchTitle, setSearchTitle] = useState("");
  const [searchType, setSearchType] = useState("");
  const [searchStatus, setSearchStatus] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<NoticeItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysNoticeApi.list({
        noticeTitle: searchTitle || undefined,
        noticeType: searchType || undefined,
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
  }, [searchTitle, searchType, searchStatus, page, pageSize, t, message]);

  useEffect(() => { void load(); }, [load]);

  function openCreate() {
    setModalMode("create");
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ noticeType: "1", status: "0", noticeContent: "", remark: "" });
    setModalOpen(true);
  }

  function openEdit(row: NoticeItem) {
    setModalMode("edit");
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      noticeTitle: row.noticeTitle,
      noticeType: row.noticeType as "1" | "2",
      noticeContent: row.noticeContent,
      status: row.status as "0" | "1",
      remark: row.remark,
    });
    setModalOpen(true);
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (modalMode === "create") {
        await SysNoticeApi.create(values);
        message.success(t("common.createSuccess"));
      } else if (editing) {
        await SysNoticeApi.patch(editing.noticeId, values);
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

  async function onDelete(row: NoticeItem) {
    try {
      await SysNoticeApi.remove(row.noticeId);
      message.success(t("common.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  const columns: ColumnsType<NoticeItem> = [
    { title: t("notice.title"), dataIndex: "noticeTitle", ellipsis: true },
    {
      title: t("notice.type"), dataIndex: "noticeType", width: 100,
      render: (v: string) => v === "1"
        ? <Tag color="blue">{t("notice.typeNotice")}</Tag>
        : <Tag color="orange">{t("notice.typeAnnouncement")}</Tag>,
    },
    {
      title: t("notice.status"), dataIndex: "status", width: 80,
      render: (s: string) => s === "0"
        ? <Tag color="success">{t("notice.statusNormal")}</Tag>
        : <Tag color="error">{t("notice.statusClosed")}</Tag>,
    },
    { title: t("notice.createBy"), dataIndex: "createBy", width: 100, render: (v: string) => v || "—" },
    { title: t("notice.createTime"), dataIndex: "createTime", width: 170, render: (v: string) => v },
    {
      title: t("common.actions"), key: "actions", width: 100, fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(row)} />
          <Popconfirm title={t("notice.confirmDelete")} onConfirm={() => void onDelete(row)} okButtonProps={{ danger: true }}>
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
        <Typography.Title level={3} style={{ margin: 0 }}>{t("notice.pageTitle")}</Typography.Title>
        <Space>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("notice.title")}
            value={searchTitle}
            onChange={(e) => setSearchTitle(e.target.value)}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 180 }}
          />
          <Select
            allowClear
            placeholder={t("notice.type")}
            value={searchType || undefined}
            onChange={(v) => setSearchType(v ?? "")}
            style={{ width: 120 }}
            options={[
              { value: "1", label: t("notice.typeNotice") },
              { value: "2", label: t("notice.typeAnnouncement") },
            ]}
          />
          <Select
            allowClear
            placeholder={t("notice.status")}
            value={searchStatus || undefined}
            onChange={(v) => setSearchStatus(v ?? "")}
            style={{ width: 100 }}
            options={[
              { value: "0", label: t("notice.statusNormal") },
              { value: "1", label: t("notice.statusClosed") },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t("common.create")}
          </Button>
        </Space>
      </div>

      <Table<NoticeItem>
        rowKey="noticeId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={pagination}
        scroll={{ x: 800 }}
      />

      <Modal
        open={modalOpen}
        title={modalMode === "create" ? t("notice.create") : t("notice.edit")}
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
          <Form.Item name="noticeTitle" label={t("notice.title")} rules={[{ required: true }]}>
            <Input autoFocus />
          </Form.Item>
          <Form.Item name="noticeType" label={t("notice.type")}>
            <Radio.Group>
              <Radio.Button value="1">{t("notice.typeNotice")}</Radio.Button>
              <Radio.Button value="2">{t("notice.typeAnnouncement")}</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="noticeContent" label={t("notice.content")}>
            <Input.TextArea rows={6} />
          </Form.Item>
          <Form.Item name="status" label={t("notice.status")}>
            <Select options={[
              { value: "0", label: t("notice.statusNormal") },
              { value: "1", label: t("notice.statusClosed") },
            ]} />
          </Form.Item>
          <Form.Item name="remark" label={t("notice.remark")}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
