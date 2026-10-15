import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { ClearOutlined, ExportOutlined, EyeOutlined } from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { indexColumn } from "@/components/indexColumn";
import { SysMeetingLogApi, type MeetingLogItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

/** 秒 → "x小时y分z秒"（单位走 i18n） */
function formatDuration(sec: number, t: (k: string) => string): string {
  if (sec <= 0) return `0${t("meetinglog.unitSecond")}`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}${t("meetinglog.unitHour")}`);
  if (m) parts.push(`${m}${t("meetinglog.unitMinute")}`);
  if (s || parts.length === 0) parts.push(`${s}${t("meetinglog.unitSecond")}`);
  return parts.join("");
}

export function MeetingLogsPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MeetingLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [searchTitle, setSearchTitle] = useState("");
  const [searchCode, setSearchCode] = useState("");
  const [searchHost, setSearchHost] = useState("");
  const [searchType, setSearchType] = useState<string | undefined>(undefined);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<MeetingLogItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysMeetingLogApi.list({
        title: searchTitle || undefined,
        meetingCode: searchCode || undefined,
        hostName: searchHost || undefined,
        meetingType: searchType,
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
  }, [searchTitle, searchCode, searchHost, searchType, page, pageSize, t, message]);

  useEffect(() => { void load(); }, [load]);

  async function onClean() {
    try {
      await SysMeetingLogApi.clean();
      message.success(t("common.deleteSuccess"));
      setPage(1);
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  async function onExport() {
    try {
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      await SysMeetingLogApi.exportCsv(
        {
          title: searchTitle || undefined,
          meetingCode: searchCode || undefined,
          hostName: searchHost || undefined,
          meetingType: searchType,
        },
        `meetinglog-${stamp}.csv`,
      );
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  const columns: ColumnsType<MeetingLogItem> = [
    indexColumn<MeetingLogItem>(page, pageSize, { title: t("common.index") }),
    { title: t("meetinglog.title"), dataIndex: "title", ellipsis: true, fixed: "left" },
    {
      title: t("meetinglog.type"), dataIndex: "meetingType", width: 100,
      render: (v: string) => v === "2"
        ? <Tag color="blue">{t("meetinglog.typeReserved")}</Tag>
        : <Tag color="green">{t("meetinglog.typeFast")}</Tag>,
    },
    { title: t("meetinglog.meetingCode"), dataIndex: "meetingCode", width: 130 },
    { title: t("meetinglog.hostName"), dataIndex: "hostName", width: 110, render: (v: string) => v || "—" },
    {
      title: t("meetinglog.participantCount"), dataIndex: "participantCount", width: 100,
      render: (v: number) => `${v} ${t("meetinglog.personUnit")}`,
    },
    {
      title: t("meetinglog.duration"), dataIndex: "durationSec", width: 110,
      render: (v: number) => formatDuration(v, t),
    },
    { title: t("meetinglog.startTime"), dataIndex: "startTime", width: 170, render: (v: string) => v || "—" },
    { title: t("meetinglog.endTime"), dataIndex: "endTime", width: 170, render: (v: string) => v || "—" },
    {
      title: t("common.actions"), key: "actions", width: 60, fixed: "right",
      render: (_, row) => (
        <Button type="text" icon={<EyeOutlined />} onClick={() => { setDetail(row); setDrawerOpen(true); }} />
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
        <Typography.Title level={3} style={{ margin: 0 }}>{t("meetinglog.pageTitle")}</Typography.Title>
        <Space wrap>
          <Input
            allowClear
            placeholder={t("meetinglog.title")}
            value={searchTitle}
            onChange={(e) => { setSearchTitle(e.target.value); setPage(1); }}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 160 }}
          />
          <Input
            allowClear
            placeholder={t("meetinglog.meetingCode")}
            value={searchCode}
            onChange={(e) => { setSearchCode(e.target.value); setPage(1); }}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 130 }}
          />
          <Input
            allowClear
            placeholder={t("meetinglog.hostName")}
            value={searchHost}
            onChange={(e) => { setSearchHost(e.target.value); setPage(1); }}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 120 }}
          />
          <Select
            allowClear
            placeholder={t("meetinglog.type")}
            value={searchType}
            onChange={(v) => { setSearchType(v ?? undefined); setPage(1); }}
            style={{ width: 120 }}
            options={[
              { value: "1", label: t("meetinglog.typeFast") },
              { value: "2", label: t("meetinglog.typeReserved") },
            ]}
          />
          <Button icon={<ExportOutlined />} onClick={() => void onExport()}>
            {t("common.export")}
          </Button>
          <Popconfirm
            title={t("meetinglog.confirmClean")}
            onConfirm={() => void onClean()}
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<ClearOutlined />}>{t("common.clean")}</Button>
          </Popconfirm>
        </Space>
      </div>

      <Table<MeetingLogItem>
        rowKey="logId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={pagination}
        scroll={{ x: 1200 }}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={t("meetinglog.detailTitle")}
        width={520}
      >
        {detail && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label={t("meetinglog.title")}>{detail.title}</Descriptions.Item>
            <Descriptions.Item label={t("meetinglog.type")}>
              {detail.meetingType === "2"
                ? <Tag color="blue">{t("meetinglog.typeReserved")}</Tag>
                : <Tag color="green">{t("meetinglog.typeFast")}</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label={t("meetinglog.meetingCode")}>{detail.meetingCode}</Descriptions.Item>
            <Descriptions.Item label={t("meetinglog.hostName")}>{detail.hostName || "—"}</Descriptions.Item>
            <Descriptions.Item label={t("meetinglog.participantCount")}>
              {detail.participantCount} {t("meetinglog.personUnit")}
            </Descriptions.Item>
            <Descriptions.Item label={t("meetinglog.startTime")}>{detail.startTime || "—"}</Descriptions.Item>
            <Descriptions.Item label={t("meetinglog.endTime")}>{detail.endTime || "—"}</Descriptions.Item>
            <Descriptions.Item label={t("meetinglog.duration")}>{formatDuration(detail.durationSec, t)}</Descriptions.Item>
            <Descriptions.Item label={t("meetinglog.createTime")}>{detail.createTime}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
