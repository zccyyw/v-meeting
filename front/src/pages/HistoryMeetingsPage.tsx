import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  Drawer,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { ArrowLeftOutlined, EyeOutlined } from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import {
  MeetingsApiExt,
  type HistoryMeetingDetail,
  type HistoryMeetingItem,
} from "@/api/client";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

function formatDuration(sec: number): string {
  if (sec <= 0) return "0";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** 历史会议：我主持的 + 我参加过的（已结束），形态对齐录制历史页 */
export function HistoryMeetingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<HistoryMeetingItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<HistoryMeetingDetail | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await MeetingsApiExt.myHistory({ page, pageSize });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      // apiErrorMessage 需要翻译上下文，这里直接抛回提示
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(row: HistoryMeetingItem) {
    setDrawerOpen(true);
    setDetailLoading(true);
    setDetail(null);
    try {
      setDetail(await MeetingsApiExt.detail(row.meetingId));
    } catch (err) {
      console.error(err);
      setDrawerOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  const columns: ColumnsType<HistoryMeetingItem> = [
    { title: t("history.title"), dataIndex: "title", ellipsis: true, fixed: "left" },
    { title: t("history.meetingCode"), dataIndex: "code", width: 130 },
    {
      title: t("history.meetingType"), dataIndex: "meetingType", width: 100,
      render: (v: string) => v === "2"
        ? <Tag color="blue">{t("history.typeReserved")}</Tag>
        : <Tag color="green">{t("history.typeFast")}</Tag>,
    },
    { title: t("history.hostName"), dataIndex: "hostName", width: 110 },
    {
      title: t("history.myRole"), dataIndex: "myRole", width: 90,
      render: (v: string) => v === "host"
        ? <Tag color="gold">{t("history.roleHost")}</Tag>
        : <Tag>{t("history.roleParticipant")}</Tag>,
    },
    {
      title: t("history.participantCount"), dataIndex: "participantCount", width: 100,
      render: (v: number) => `${v}`,
    },
    {
      title: t("history.duration"), dataIndex: "durationSec", width: 100,
      render: (v: number) => formatDuration(v),
    },
    { title: t("history.startTime"), dataIndex: "startTime", width: 170 },
    { title: t("history.endTime"), dataIndex: "endTime", width: 170 },
    {
      title: t("common.actions"), key: "actions", width: 70, fixed: "right",
      render: (_, row) => (
        <Button type="text" icon={<EyeOutlined />} onClick={() => void openDetail(row)} />
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
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/")}>
            {t("history.backHome")}
          </Button>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t("history.pageTitle")}
          </Typography.Title>
        </Space>
      </div>

      <Table<HistoryMeetingItem>
        rowKey="meetingId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={pagination}
        scroll={{ x: 1200 }}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={detail?.title ?? t("history.detailTitle")}
        width={520}
        loading={detailLoading}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                {t("history.meetingInfo")}
              </Typography.Text>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: "#8c8c8c", minWidth: 80 }}>{t("history.meetingCode")}</span>
                  <span>{detail.code}</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: "#8c8c8c", minWidth: 80 }}>{t("history.meetingType")}</span>
                  <Tag color={detail.meetingType === "2" ? "blue" : "green"} style={{ marginInlineEnd: 0 }}>
                    {detail.meetingType === "2" ? t("history.typeReserved") : t("history.typeFast")}
                  </Tag>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: "#8c8c8c", minWidth: 80 }}>{t("history.hostName")}</span>
                  <span>{detail.hostName}</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: "#8c8c8c", minWidth: 80 }}>{t("history.duration")}</span>
                  <span>{formatDuration(detail.durationSec)}</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: "#8c8c8c", minWidth: 80 }}>{t("history.participantCount")}</span>
                  <span>{detail.attendeeCount}</span>
                </div>
              </div>
            </div>
            <div>
              <Typography.Text strong style={{ display: "block", marginBottom: 8 }}>
                {t("history.attendees")}
              </Typography.Text>
              {detail.attendees.length === 0 && (
                <Typography.Text type="secondary">{t("history.noAttendees")}</Typography.Text>
              )}
              {detail.attendees.map((a, idx) => (
                <div
                  key={`${a.name}-${idx}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 4px", borderBottom: "1px dashed #f0f0f0",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.name || "—"}
                  </span>
                  {a.deptName && (
                    <span style={{ fontSize: 12, color: "#8c8c8c" }}>{a.deptName}</span>
                  )}
                  <span style={{ fontSize: 12, color: "#8c8c8c" }}>{a.joinedAt}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
