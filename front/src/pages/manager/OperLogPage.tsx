import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Drawer,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  DeleteOutlined,
  ClearOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { SysOperLogApi, type OperLogItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

const businessTypeMap: Record<number, { color: string; labelKey: string }> = {
  0: { color: "default", labelKey: "operlog.businessOther" },
  1: { color: "success", labelKey: "operlog.businessAdd" },
  2: { color: "blue", labelKey: "operlog.businessUpdate" },
  3: { color: "error", labelKey: "operlog.businessDelete" },
  4: { color: "warning", labelKey: "operlog.businessExport" },
  5: { color: "orange", labelKey: "operlog.businessImport" },
  6: { color: "purple", labelKey: "operlog.businessLogin" },
  7: { color: "magenta", labelKey: "operlog.businessLogout" },
};

export function OperLogPage() {
const { t } = useTranslation();
const { message } = AntApp.useApp();
const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<OperLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [searchTitle] = useState("");
  const [searchUser] = useState("");
  const [searchType, setSearchType] = useState("");
  const [searchStatus, setSearchStatus] = useState<number | undefined>(undefined);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<OperLogItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysOperLogApi.list({
        title: searchTitle || undefined,
        operUserName: searchUser || undefined,
        logType: searchType || undefined,
        status: searchStatus,
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
  }, [searchTitle, searchUser, searchType, searchStatus, page, pageSize, t, message]);

  useEffect(() => { void load(); }, [load]);

  async function onClean() {
    try {
      await SysOperLogApi.clean();
      message.success(t("common.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  async function onDelete(row: OperLogItem) {
    try {
      await SysOperLogApi.remove(row.operId);
      message.success(t("common.deleteSuccess"));
      await load();
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  function showDetail(row: OperLogItem) {
    setDetail(row);
    setDrawerOpen(true);
  }

  const columns: ColumnsType<OperLogItem> = [
    {
      title: t("operlog.title"), dataIndex: "title", width: 100, fixed: "left",
    },
    {
      title: t("operlog.businessType"), dataIndex: "businessType", width: 80,
      render: (v: number) => {
        const m = businessTypeMap[v] ?? businessTypeMap[0];
        return <Tag color={m.color}>{t(m.labelKey)}</Tag>;
      },
    },
    {
      title: t("operlog.requestMethod"), dataIndex: "requestMethod", width: 80,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: t("operlog.operUrl"), dataIndex: "operUrl", width: 200, ellipsis: true },
    { title: t("operlog.operUserName"), dataIndex: "operUserName", width: 100 },
    { title: t("operlog.operIp"), dataIndex: "operIp", width: 130 },
    {
      title: t("operlog.status"), dataIndex: "status", width: 80,
      render: (s: number) => s === 0
        ? <Tag color="success">{t("operlog.statusSuccess")}</Tag>
        : <Tag color="error">{t("operlog.statusFail")}</Tag>,
    },
    {
      title: t("operlog.costTime"), dataIndex: "costTime", width: 80,
      render: (v: number) => `${v}ms`,
    },
    { title: t("operlog.operTime"), dataIndex: "operTime", width: 170 },
    {
      title: t("common.actions"), key: "actions", width: 100, fixed: "right",
      render: (_, row) => (
        <Space size={4}>
          <Button type="text" icon={<EyeOutlined />} onClick={() => showDetail(row)} />
          <Popconfirm title={t("operlog.confirmDelete")} onConfirm={() => void onDelete(row)} okButtonProps={{ danger: true }}>
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
        <Typography.Title level={3} style={{ margin: 0 }}>{t("operlog.pageTitle")}</Typography.Title>
        <Space>
          <Select
            allowClear
            placeholder={t("operlog.logType")}
            value={searchType || undefined}
            onChange={(v) => setSearchType(v ?? "")}
            style={{ width: 120 }}
            options={[
              { value: "operation", label: t("operlog.logTypeOperation") },
              { value: "login", label: t("operlog.logTypeLogin") },
            ]}
          />
          <Select
            allowClear
            placeholder={t("operlog.status")}
            value={searchStatus}
            onChange={(v) => setSearchStatus(v ?? undefined)}
            style={{ width: 100 }}
            options={[
              { value: 0, label: t("operlog.statusSuccess") },
              { value: 1, label: t("operlog.statusFail") },
            ]}
          />
          <Popconfirm title={t("operlog.confirmClean")} onConfirm={() => void onClean()} okButtonProps={{ danger: true }}>
            <Button danger icon={<ClearOutlined />}>{t("operlog.clean")}</Button>
          </Popconfirm>
        </Space>
      </div>

      <Table<OperLogItem>
        rowKey="operId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={pagination}
        scroll={{ x: 1200 }}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={t("operlog.detailTitle")}
        width={520}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <Typography.Text strong>{t("operlog.title")}: </Typography.Text>
              <span>{detail.title}</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.businessType")}: </Typography.Text>
              <Tag color={(businessTypeMap[detail.businessType] ?? businessTypeMap[0]).color}>
                {t((businessTypeMap[detail.businessType] ?? businessTypeMap[0]).labelKey)}
              </Tag>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.method")}: </Typography.Text>
              <span>{detail.method}</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.requestMethod")}: </Typography.Text>
              <Tag>{detail.requestMethod}</Tag>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.operUrl")}: </Typography.Text>
              <span>{detail.operUrl}</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.operIp")}: </Typography.Text>
              <span>{detail.operIp}</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.operUserName")}: </Typography.Text>
              <span>{detail.operUserName}</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.status")}: </Typography.Text>
              {detail.status === 0
                ? <Tag color="success">{t("operlog.statusSuccess")}</Tag>
                : <Tag color="error">{t("operlog.statusFail")}</Tag>}
            </div>
            <div>
              <Typography.Text strong>{t("operlog.costTime")}: </Typography.Text>
              <span>{detail.costTime}ms</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.operTime")}: </Typography.Text>
              <span>{detail.operTime}</span>
            </div>
            {detail.operParam && (
              <div>
                <Typography.Text strong>{t("operlog.operParam")}: </Typography.Text>
                <pre style={{ background: token.colorFillQuaternary, padding: 8, borderRadius: 4, overflow: "auto", maxHeight: 200, fontSize: 12 }}>
                  {detail.operParam}
                </pre>
              </div>
            )}
            {detail.errorMsg && (
              <div>
                <Typography.Text strong>{t("operlog.errorMsg")}: </Typography.Text>
                <pre style={{ background: token.colorErrorBg, padding: 8, borderRadius: 4, color: token.colorError, fontSize: 12 }}>
                  {detail.errorMsg}
                </pre>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
