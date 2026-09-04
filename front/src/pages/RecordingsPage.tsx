import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  App as AntApp,
  Button,
  Card,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import {
  DeleteOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  HomeOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { RecordingsApi, type RecordingItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatTime(iso: string, localeTag: string): string {
  try {
    return new Date(iso).toLocaleString(localeTag);
  } catch {
    return iso;
  }
}

function RecordingsPageInner() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const localeTag = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";

  const [items, setItems] = useState<RecordingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);

  const [previewing, setPreviewing] = useState<RecordingItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth <= 720,
  );
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 720);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await RecordingsApi.list({ page, pageSize });
      setItems(res.items);
      setTotal(res.total);
      setPage(res.page);
      setPageSize(res.pageSize);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, t, message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function meetingLabel(r: RecordingItem): string {
    if (r.meetingTitle) {
      return r.meetingCode
        ? `${r.meetingTitle} (${r.meetingCode})`
        : r.meetingTitle;
    }
    return r.title || t("recordings.untitled");
  }

  async function handlePreview(r: RecordingItem) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewing(r);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const blob = await RecordingsApi.fetchBlob(r.id);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      message.error(apiErrorMessage(t, err));
      setPreviewing(null);
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewing(null);
    setPreviewLoading(false);
  }

  async function handleDelete(r: RecordingItem) {
    try {
      await RecordingsApi.remove(r.id);
      if (previewing?.id === r.id) closePreview();
      message.success(t("recordings.deleted"));
      if (items.length <= 1 && page > 1) {
        setPage((p) => p - 1);
      } else {
        await load();
      }
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  async function handleDownload(r: RecordingItem) {
    try {
      const blob = await RecordingsApi.fetchBlob(r.id);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${r.title}.webm`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  const columns: ColumnsType<RecordingItem> = [
    {
      title: t("recordings.meeting"),
      key: "meeting",
      ellipsis: true,
      render: (_, r) => meetingLabel(r),
    },
    {
      title: t("recordings.duration"),
      dataIndex: "durationMs",
      width: 110,
      render: (ms: number) => formatDuration(ms),
    },
    {
      title: t("recordings.size"),
      dataIndex: "sizeBytes",
      width: 110,
      render: (bytes: number) => formatSize(bytes),
    },
    {
      title: t("recordings.createdAt"),
      dataIndex: "createdAt",
      width: 180,
      render: (v: string) => formatTime(v, localeTag),
    },
    {
      title: t("recordings.actions"),
      key: "actions",
      width: 140,
      fixed: "right",
      render: (_, r) => (
        <Space size={4}>
          <Button
            type="text"
            icon={<PlayCircleOutlined />}
            aria-label={t("recordings.preview")}
            title={t("recordings.preview")}
            onClick={() => void handlePreview(r)}
          />
          <Button
            type="text"
            icon={<DownloadOutlined />}
            aria-label={t("recordings.download")}
            title={t("recordings.download")}
            onClick={() => void handleDownload(r)}
          />
          <Popconfirm
            title={t("recordings.confirmDelete")}
            okText={t("recordings.delete")}
            cancelText={t("common.cancel")}
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleDelete(r)}
          >
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label={t("recordings.delete")}
              title={t("recordings.delete")}
            />
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
    showTotal: (n, range) =>
      t("recordings.pageInfo", { from: range[0], to: range[1], total: n }),
    onChange: (p, size) => {
      if (size !== pageSize) {
        setPage(1);
        setPageSize(size);
      } else {
        setPage(p);
      }
    },
  };

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            <Space size={8}>
              <VideoCameraOutlined />
              {t("recordings.title")}
              <Tooltip title={t("recordings.backHome")}>
                <Button
                  type="text"
                  size="small"
                  icon={<HomeOutlined />}
                  aria-label={t("recordings.backHome")}
                  onClick={() => navigate("/")}
                />
              </Tooltip>
            </Space>
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ margin: "6px 0 0" }}>
            {t("recordings.subtitle")}
          </Typography.Paragraph>
        </div>
      </div>

      <Card className="admin-page-card" styles={{ body: { padding: 0 } }}>
        <Table<RecordingItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          pagination={pagination}
          scroll={{ x: 800 }}
          size={isMobile ? "small" : "middle"}
          locale={{ emptyText: t("recordings.empty") }}
        />
      </Card>

      <Modal
        open={previewing !== null}
        title={previewing ? meetingLabel(previewing) : ""}
        onCancel={closePreview}
        footer={
          <Space>
            <Button
              icon={<DownloadOutlined />}
              disabled={!previewing || previewLoading}
              onClick={() => previewing && void handleDownload(previewing)}
            >
              {t("recordings.download")}
            </Button>
            <Button type="primary" onClick={closePreview}>
              {t("common.close")}
            </Button>
          </Space>
        }
        width={isMobile ? "94%" : "min(72vw, 960px)"}
        centered
        destroyOnHidden
        className="recordings-preview-modal"
        styles={{
          body: { paddingTop: 12 },
        }}
      >
        <div className="recordings-preview-antd">
          {previewLoading ? (
            <div className="recordings-preview-antd-loading">
              {t("common.loading")}
            </div>
          ) : previewUrl ? (
            <video
              src={previewUrl}
              controls
              autoPlay
              className="recordings-preview-antd-video"
            />
          ) : null}
          {previewing && (
            <div className="recordings-preview-antd-meta">
              <span>
                {t("recordings.duration")}：{formatDuration(previewing.durationMs)}
              </span>
              <span>
                {t("recordings.size")}：{formatSize(previewing.sizeBytes)}
              </span>
              <span>
                {t("recordings.createdAt")}：
              </span>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

export function RecordingsPage() {
  return <RecordingsPageInner />;
}
