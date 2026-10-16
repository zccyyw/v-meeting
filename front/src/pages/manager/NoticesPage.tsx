import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
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
  theme,
} from "antd";
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { indexColumn } from "@/components/indexColumn";
import { RichTextEditor } from "@/components/RichTextEditor";
import { MemberPicker, type MemberPickerValue } from "@/components/MemberPicker";
import { SysNoticeApi, type NoticeItem } from "@/api/client";
import { sanitizeHtml } from "@/utils/sanitizeHtml";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

type FormValues = {
  noticeTitle: string;
  noticeType: "1" | "2";
  noticeContent: string;
  status: "0" | "1";
  remark: string;
  targets?: MemberPickerValue;
};

/** 将 Form 值组装为提交体：type=1 携带定向接收范围，type=2 全员不带 */
function buildPayload(values: FormValues): Record<string, unknown> {
  const body: Record<string, unknown> = {
    noticeTitle: values.noticeTitle,
    noticeType: values.noticeType,
    noticeContent: values.noticeContent,
    status: values.status,
    remark: values.remark,
  };
  if (values.noticeType === "1" && values.targets) {
    body.targetUserIds = values.targets.userIds;
    body.targetDeptIds = values.targets.deptIds;
  }
  return body;
}

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
  // 通知类型联动：type=1（通知）显示接收范围选择器，type=2（公告）全员
  const noticeType = Form.useWatch("noticeType", form);
  const { token } = theme.useToken();
  // 详情 Drawer：基本信息 + 富文本 + 接收用户已读/未读
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<NoticeItem | null>(null);

  async function openDetail(row: NoticeItem) {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await SysNoticeApi.get(row.noticeId));
    } catch (err) {
      message.error(apiErrorMessage(t, err));
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

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
    form.setFieldsValue({ noticeType: "1", status: "0", noticeContent: "", remark: "", targets: { userIds: [], deptIds: [] } });
    setModalOpen(true);
  }

  async function openEdit(row: NoticeItem) {
    setModalMode("edit");
    setEditing(row);
    form.resetFields();
    // 详情接口返回接收范围（列表行不含），用于编辑回显
    try {
      const detail = await SysNoticeApi.get(row.noticeId);
      form.setFieldsValue({
        noticeTitle: detail.noticeTitle,
        noticeType: detail.noticeType as "1" | "2",
        noticeContent: detail.noticeContent,
        status: detail.status as "0" | "1",
        remark: detail.remark,
        targets: {
          userIds: detail.targetUserIds ?? [],
          deptIds: detail.targetDeptIds ?? [],
        },
      });
    } catch (err) {
      message.error(apiErrorMessage(t, err));
      return;
    }
    setModalOpen(true);
  }

  async function onSubmit() {
    try {
      const values = await form.validateFields();
      // type=1（通知）必须指定接收范围（部门/用户至少一项），后端同口径校验
      if (values.noticeType === "1") {
        const t0 = values.targets ?? { userIds: [], deptIds: [] };
        if (t0.userIds.length === 0 && t0.deptIds.length === 0) {
          message.warning(t("notice.targetRequired"));
          return;
        }
      }
      const payload = buildPayload(values);
      setSubmitting(true);
      if (modalMode === "create") {
        await SysNoticeApi.create(payload);
        message.success(t("common.createSuccess"));
      } else if (editing) {
        await SysNoticeApi.patch(editing.noticeId, payload);
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
    indexColumn<NoticeItem>(page, pageSize, { title: t("common.index") }),
    { title: t("notice.title"), dataIndex: "noticeTitle", ellipsis: true },
    {
      title: t("notice.type"), dataIndex: "noticeType", width: 100,
      render: (v: string) => v === "1"
        ? <Tag color="blue">{t("notice.typeNotice")}</Tag>
        : <Tag color="orange">{t("notice.typeAnnouncement")}</Tag>,
    },
    {
      title: t("notice.targetScope"), dataIndex: "targetCount", width: 110,
      render: (_: unknown, row: NoticeItem) => {
        if (row.noticeType === "2" || row.targetCount === -1) {
          return <Tag color="green">{t("notice.targetAll")}</Tag>;
        }
        return <Tag>{t("notice.targetCounted", { count: row.targetCount ?? 0 })}</Tag>;
      },
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
      title: t("common.actions"), key: "actions", width: 130, fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button type="text" icon={<EyeOutlined />} onClick={() => void openDetail(row)} />
          <Button type="text" icon={<EditOutlined />} onClick={() => void openEdit(row)} />
          <Popconfirm title={t("notice.confirmDelete")} onConfirm={() => void onDelete(row)} okButtonProps={{ danger: true }}>
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
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
        width={720}
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
          {noticeType === "1" && (
            <Form.Item name="targets" label={t("notice.targetScope")}>
              <MemberPicker />
            </Form.Item>
          )}
          <Form.Item name="noticeContent" label={t("notice.content")}>
            <RichTextEditor placeholder={t("notice.contentPlaceholder")} />
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

      <Drawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail?.noticeTitle ?? t("common.detail")}
        width={560}
        loading={detailLoading}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label={t("notice.type")}>
                <Tag color={detail.noticeType === "1" ? "blue" : "orange"}>
                  {detail.noticeType === "1" ? t("notice.typeNotice") : t("notice.typeAnnouncement")}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label={t("notice.targetScope")}>
                {detail.targetCount === -1
                  ? <Tag color="green">{t("notice.targetAll")}</Tag>
                  : <Tag>{t("notice.targetCounted", { count: detail.targetCount ?? 0 })}</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label={t("notice.createBy")}>{detail.createBy || "—"}</Descriptions.Item>
              <Descriptions.Item label={t("notice.createTime")}>{detail.createTime}</Descriptions.Item>
              {detail.remark && (
                <Descriptions.Item label={t("notice.remark")}>{detail.remark}</Descriptions.Item>
              )}
            </Descriptions>

            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                {t("notice.content")}
              </Typography.Text>
              <div
                className="notice-detail-content"
                style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 6, padding: "8px 12px", minHeight: 60 }}
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(detail.noticeContent) }}
              />
            </div>

            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                {t("notice.recipients")}
                <Typography.Text type="secondary" style={{ fontWeight: 400, marginLeft: 8 }}>
                  {t("notice.readSummary", {
                    read: detail.readCount ?? 0,
                    unread: (detail.totalCount ?? 0) - (detail.readCount ?? 0),
                    total: detail.totalCount ?? 0,
                  })}
                </Typography.Text>
              </Typography.Text>
              {(detail.recipients ?? []).map((r) => (
                <div
                  key={r.userId}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 4px", borderBottom: `1px dashed ${token.colorBorderSecondary}`,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.name || `#${r.userId}`}
                  </span>
                  {r.deptName && (
                    <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{r.deptName}</span>
                  )}
                  <Tag color={r.read ? "default" : "processing"} style={{ marginInlineEnd: 0 }}>
                    {r.read ? t("notice.read") : t("notice.unread")}
                  </Tag>
                </div>
              ))}
              {(detail.recipients ?? []).length === 0 && (
                <Typography.Text type="secondary">{t("notice.noRecipient")}</Typography.Text>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
