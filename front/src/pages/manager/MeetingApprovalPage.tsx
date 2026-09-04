import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Card,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  EyeOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { MeetingAppApi, type MeetingAppItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

const priorityColors: Record<string, string> = {
  "高": "red",
  "中": "orange",
  "低": "green",
};

const statusColors: Record<string, string> = {
  pending: "processing",
  approved: "success",
  rejected: "error",
};

export function MeetingApprovalPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MeetingAppItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterPriority, setFilterPriority] = useState<string>("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<MeetingAppItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await MeetingAppApi.list({
        status: filterStatus || undefined,
        priority: filterPriority || undefined,
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
  }, [filterStatus, filterPriority, page, pageSize, message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function openDetail(record: MeetingAppItem) {
    setDetail(record);
    setRejectReason("");
    setDrawerOpen(true);
  }

  async function onApprove(approved: boolean) {
    if (!detail) return;
    setBusy(true);
    try {
      await MeetingAppApi.approve(detail.appId, {
        approved,
        rejectReason: approved ? undefined : rejectReason.trim() || undefined,
      });
      message.success(t("common.success"));
      setDrawerOpen(false);
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  async function onStartMeeting(record: MeetingAppItem) {
    setBusy(true);
    try {
      const res = await MeetingAppApi.start(record.appId);
      message.success(t("meetingApp.started", { code: res.code }));
      // Navigate to meeting
      navigate(`/m/${res.meetingId}?code=${res.code}`);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setBusy(false);
    }
  }

  const columns: ColumnsType<MeetingAppItem> = [
    {
      title: t("meetingApp.title"),
      dataIndex: "title",
      key: "title",
      width: 180,
      ellipsis: true,
    },
    {
      title: t("meetingApp.meetingTime"),
      dataIndex: "meetingTime",
      key: "meetingTime",
      width: 160,
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: t("meetingApp.location"),
      dataIndex: "location",
      key: "location",
      width: 120,
      ellipsis: true,
      render: (val: string) => val || "-",
    },
    {
      title: t("meetingApp.deptCount"),
      dataIndex: "deptCount",
      key: "deptCount",
      width: 90,
      align: "center",
    },
    {
      title: t("meetingApp.priority"),
      dataIndex: "priority",
      key: "priority",
      width: 80,
      align: "center",
      render: (val: string) => (
        <Tag color={priorityColors[val] ?? "default"}>{val}</Tag>
      ),
      sorter: (a, b) => {
        const order = { "高": 0, "中": 1, "低": 2 };
        return (order[a.priority as keyof typeof order] ?? 3) - (order[b.priority as keyof typeof order] ?? 3);
      },
    },
    {
      title: t("meetingApp.status"),
      dataIndex: "status",
      key: "status",
      width: 90,
      align: "center",
      render: (val: string) => (
        <Tag color={statusColors[val] ?? "default"}>
          {t(`meetingApp.status_${val}`)}
        </Tag>
      ),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 280,
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDetail(record)}
          >
            {t("common.detail")}
          </Button>
          {record.status === "pending" && (
            <>
              <Popconfirm
                title={t("meetingApp.confirmApprove")}
                onConfirm={() => {
                  setDetail(record);
                  void onApprove(true);
                }}
                okText={t("common.confirm")}
                cancelText={t("common.cancel")}
              >
                <Button size="small" type="primary" icon={<CheckOutlined />}>
                  {t("meetingApp.approve")}
                </Button>
              </Popconfirm>
              <Button
                size="small"
                danger
                icon={<CloseOutlined />}
                onClick={() => {
                  setDetail(record);
                  setRejectReason("");
                  setDrawerOpen(true);
                }}
              >
                {t("meetingApp.reject")}
              </Button>
            </>
          )}
          {record.status === "approved" && !record.meetingId && (
            <Button
              size="small"
              type="primary"
              icon={<ThunderboltOutlined />}
              loading={busy}
              onClick={() => void onStartMeeting(record)}
            >
              {t("meetingApp.startMeeting")}
            </Button>
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
    onChange: (p, ps) => {
      setPage(p);
      setPageSize(ps);
    },
    showTotal: (tot) => `${t("common.total")} ${tot}`,
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>
          {t("meetingApp.title")}
        </h1>
        <Space>
          <Select
            placeholder={t("meetingApp.status")}
            value={filterStatus || undefined}
            onChange={(v) => { setFilterStatus(v ?? ""); setPage(1); }}
            allowClear
            style={{ width: 140 }}
            options={[
              { value: "pending", label: t("meetingApp.status_pending") },
              { value: "approved", label: t("meetingApp.status_approved") },
              { value: "rejected", label: t("meetingApp.status_rejected") },
            ]}
          />
          <Select
            placeholder={t("meetingApp.priority")}
            value={filterPriority || undefined}
            onChange={(v) => { setFilterPriority(v ?? ""); setPage(1); }}
            allowClear
            style={{ width: 120 }}
            options={[
              { value: "高", label: t("meetingApp.priorityHigh") },
              { value: "中", label: t("meetingApp.priorityMedium") },
              { value: "低", label: t("meetingApp.priorityLow") },
            ]}
          />
        </Space>
      </div>

      <Card className="admin-page-card">
        <Table
          columns={columns}
          dataSource={items}
          rowKey="appId"
          loading={loading}
          pagination={pagination}
          scroll={{ x: 900 }}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        title={t("meetingApp.detail")}
        onClose={() => setDrawerOpen(false)}
        width={500}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <Text type="secondary">{t("meetingApp.title")}</Text>
              <Paragraph>{detail.title}</Paragraph>
            </div>
            <div>
              <Text type="secondary">{t("meetingApp.meetingTime")}</Text>
              <Paragraph>{new Date(detail.meetingTime).toLocaleString()}</Paragraph>
            </div>
            {detail.endTime && (
              <div>
                <Text type="secondary">{t("meetingApp.endTime")}</Text>
                <Paragraph>{new Date(detail.endTime).toLocaleString()}</Paragraph>
              </div>
            )}
            <div>
              <Text type="secondary">{t("meetingApp.location")}</Text>
              <Paragraph>{detail.location || "-"}</Paragraph>
            </div>
            <div>
              <Text type="secondary">{t("meetingApp.deptCount")}</Text>
              <Paragraph>{detail.deptCount}</Paragraph>
            </div>
            <div>
              <Text type="secondary">{t("meetingApp.priority")}</Text>
              <Paragraph>
                <Tag color={priorityColors[detail.priority] ?? "default"}>
                  {detail.priority}
                </Tag>
              </Paragraph>
            </div>
            <div>
              <Text type="secondary">{t("meetingApp.status")}</Text>
              <Paragraph>
                <Tag color={statusColors[detail.status] ?? "default"}>
                  {t(`meetingApp.status_${detail.status}`)}
                </Tag>
              </Paragraph>
            </div>
            {detail.remark && (
              <div>
                <Text type="secondary">{t("meetingApp.remark")}</Text>
                <Paragraph>{detail.remark}</Paragraph>
              </div>
            )}
            {detail.createdAt && (
              <div>
                <Text type="secondary">{t("meetingApp.createdAt")}</Text>
                <Paragraph>{new Date(detail.createdAt).toLocaleString()}</Paragraph>
              </div>
            )}

            {detail.status === "pending" && (
              <>
                <div>
                  <Text type="secondary">{t("meetingApp.rejectReason")}</Text>
                  <TextArea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    rows={3}
                    maxLength={500}
                  />
                </div>
                <Space>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    loading={busy}
                    onClick={() => void onApprove(true)}
                  >
                    {t("meetingApp.approve")}
                  </Button>
                  <Button
                    danger
                    icon={<CloseOutlined />}
                    loading={busy}
                    onClick={() => void onApprove(false)}
                  >
                    {t("meetingApp.reject")}
                  </Button>
                </Space>
              </>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
