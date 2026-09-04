import { useCallback, useEffect, useState } from "react";
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
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { UserApprovalApi, type UserApprovalItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

const requestTypeLabels: Record<string, string> = {
  create: "meetingApp.reqCreate",
  update: "meetingApp.reqUpdate",
  delete: "meetingApp.reqDelete",
  resetPwd: "meetingApp.reqResetPwd",
};

const statusColors: Record<string, string> = {
  pending: "processing",
  approved: "success",
  rejected: "error",
  execution_failed: "warning",
};

export function UserApprovalPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<UserApprovalItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [filterStatus, setFilterStatus] = useState<string>("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<UserApprovalItem | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await UserApprovalApi.list({
        status: filterStatus || undefined,
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
  }, [filterStatus, page, pageSize, message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function openDetail(record: UserApprovalItem) {
    setDetail(record);
    setRejectReason("");
    setDrawerOpen(true);
  }

  async function onApprove(approved: boolean) {
    if (!detail) return;
    setBusy(true);
    try {
      await UserApprovalApi.approve(detail.approvalId, {
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

  function renderRequesterData(data: Record<string, unknown> | null) {
    if (!data) return "-";
    const entries = Object.entries(data);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {entries.map(([key, val]) => (
          <div key={key} style={{ display: "flex", gap: "0.5rem" }}>
            <Text type="secondary" style={{ minWidth: 100 }}>{key}:</Text>
            <Text>
              {key.toLowerCase().includes("password") ? "***" : String(val)}
            </Text>
          </div>
        ))}
      </div>
    );
  }

  const columns: ColumnsType<UserApprovalItem> = [
    {
      title: t("meetingApp.requestType"),
      dataIndex: "requestType",
      key: "requestType",
      width: 100,
      align: "center",
      render: (val: string) => (
        <Tag color="blue">{t(requestTypeLabels[val] ?? val)}</Tag>
      ),
    },
    {
      title: t("meetingApp.targetUserId"),
      dataIndex: "targetUserId",
      key: "targetUserId",
      width: 100,
      align: "center",
      render: (val: number | null) => val ?? "-",
    },
    {
      title: t("meetingApp.requesterId"),
      dataIndex: "requesterId",
      key: "requesterId",
      width: 100,
      align: "center",
    },
    {
      title: t("meetingApp.status"),
      dataIndex: "status",
      key: "status",
      width: 100,
      align: "center",
      render: (val: string) => (
        <Tag color={statusColors[val] ?? "default"}>
          {t(`meetingApp.status_${val}`)}
        </Tag>
      ),
    },
    {
      title: t("meetingApp.createTime"),
      dataIndex: "createTime",
      key: "createTime",
      width: 160,
      render: (val: string) => val ? new Date(val).toLocaleString() : "-",
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 260,
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
          {t("meetingApp.userApprovalTitle")}
        </h1>
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
            { value: "execution_failed", label: t("meetingApp.status_execution_failed") },
          ]}
        />
      </div>

      <Card className="admin-page-card">
        <Table
          columns={columns}
          dataSource={items}
          rowKey="approvalId"
          loading={loading}
          pagination={pagination}
          scroll={{ x: 800 }}
        />
      </Card>

      <Drawer
        open={drawerOpen}
        title={t("meetingApp.userApprovalDetail")}
        onClose={() => setDrawerOpen(false)}
        width={500}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <Text type="secondary">{t("meetingApp.requestType")}</Text>
              <Paragraph>
                <Tag color="blue">{t(requestTypeLabels[detail.requestType] ?? detail.requestType)}</Tag>
              </Paragraph>
            </div>
            <div>
              <Text type="secondary">{t("meetingApp.targetUserId")}</Text>
              <Paragraph>{detail.targetUserId ?? "-"}</Paragraph>
            </div>
            <div>
              <Text type="secondary">{t("meetingApp.requesterId")}</Text>
              <Paragraph>{detail.requesterId}</Paragraph>
            </div>
            <div>
              <Text type="secondary">{t("meetingApp.status")}</Text>
              <Paragraph>
                <Tag color={statusColors[detail.status] ?? "default"}>
                  {t(`meetingApp.status_${detail.status}`)}
                </Tag>
              </Paragraph>
            </div>
            {detail.requesterData && (
              <div>
                <Text type="secondary">{t("meetingApp.requesterData")}</Text>
                <Paragraph>{renderRequesterData(detail.requesterData)}</Paragraph>
              </div>
            )}
            {detail.rejectReason && (
              <div>
                <Text type="secondary">{t("meetingApp.rejectReason")}</Text>
                <Paragraph>{detail.rejectReason}</Paragraph>
              </div>
            )}
            <div>
              <Text type="secondary">{t("meetingApp.createTime")}</Text>
              <Paragraph>{detail.createTime ? new Date(detail.createTime).toLocaleString() : "-"}</Paragraph>
            </div>

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
