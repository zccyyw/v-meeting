import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import { ClearOutlined, ExportOutlined, EyeOutlined } from "@ant-design/icons";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import { indexColumn } from "@/components/indexColumn";
import { SysLoginLogApi, type LoginLogItem } from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const PAGE_SIZE_OPTIONS = ["10", "20", "30", "50"];

const actionMap: Record<number, { color: string; labelKey: string }> = {
  6: { color: "purple", labelKey: "loginlog.actionLogin" },
  7: { color: "magenta", labelKey: "loginlog.actionLogout" },
};

export function LoginLogsPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LoginLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [searchUser, setSearchUser] = useState("");
  const [searchIp, setSearchIp] = useState("");
  const [searchAction, setSearchAction] = useState<number | undefined>(undefined);
  const [searchStatus, setSearchStatus] = useState<number | undefined>(undefined);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detail, setDetail] = useState<LoginLogItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await SysLoginLogApi.list({
        operUserName: searchUser || undefined,
        operIp: searchIp || undefined,
        businessType: searchAction,
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
  }, [searchUser, searchIp, searchAction, searchStatus, page, pageSize, t, message]);

  useEffect(() => { void load(); }, [load]);

  async function onClean() {
    try {
      await SysLoginLogApi.clean();
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
      await SysLoginLogApi.exportCsv(
        {
          operUserName: searchUser || undefined,
          operIp: searchIp || undefined,
          businessType: searchAction,
          status: searchStatus,
        },
        `loginlog-${stamp}.csv`,
      );
    } catch (err) {
      message.error(apiErrorMessage(t, err));
    }
  }

  const columns: ColumnsType<LoginLogItem> = [
    indexColumn<LoginLogItem>(page, pageSize, { title: t("common.index") }),
    {
      title: t("loginlog.action"), dataIndex: "businessType", width: 90,
      render: (v: number) => {
        const m = actionMap[v] ?? { color: "default", labelKey: "loginlog.actionLogin" };
        return <Tag color={m.color}>{t(m.labelKey)}</Tag>;
      },
    },
    { title: t("operlog.operUserName"), dataIndex: "operUserName", width: 120 },
    { title: t("operlog.operIp"), dataIndex: "operIp", width: 140 },
    {
      title: t("operlog.status"), dataIndex: "status", width: 90,
      render: (s: number) => s === 0
        ? <Tag color="success">{t("operlog.statusSuccess")}</Tag>
        : <Tag color="error">{t("operlog.statusFail")}</Tag>,
    },
    { title: t("operlog.errorMsg"), dataIndex: "errorMsg", ellipsis: true, render: (v: string) => v || "—" },
    { title: t("operlog.costTime"), dataIndex: "costTime", width: 90, render: (v: number) => `${v}ms` },
    { title: t("operlog.operTime"), dataIndex: "operTime", width: 170 },
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
        <Typography.Title level={3} style={{ margin: 0 }}>{t("loginlog.pageTitle")}</Typography.Title>
        <Space wrap>
          <Input
            allowClear
            placeholder={t("operlog.operUserName")}
            value={searchUser}
            onChange={(e) => { setSearchUser(e.target.value); setPage(1); }}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 140 }}
          />
          <Input
            allowClear
            placeholder={t("operlog.operIp")}
            value={searchIp}
            onChange={(e) => { setSearchIp(e.target.value); setPage(1); }}
            onPressEnter={() => { setPage(1); void load(); }}
            style={{ width: 140 }}
          />
          <Select
            allowClear
            placeholder={t("loginlog.action")}
            value={searchAction}
            onChange={(v) => { setSearchAction(v ?? undefined); setPage(1); }}
            style={{ width: 100 }}
            options={[
              { value: 6, label: t("loginlog.actionLogin") },
              { value: 7, label: t("loginlog.actionLogout") },
            ]}
          />
          <Select
            allowClear
            placeholder={t("operlog.status")}
            value={searchStatus}
            onChange={(v) => { setSearchStatus(v ?? undefined); setPage(1); }}
            style={{ width: 100 }}
            options={[
              { value: 0, label: t("operlog.statusSuccess") },
              { value: 1, label: t("operlog.statusFail") },
            ]}
          />
          <Button icon={<ExportOutlined />} onClick={() => void onExport()}>
            {t("common.export")}
          </Button>
          <Popconfirm
            title={t("loginlog.confirmClean")}
            onConfirm={() => void onClean()}
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<ClearOutlined />}>{t("common.clean")}</Button>
          </Popconfirm>
        </Space>
      </div>

      <Table<LoginLogItem>
        rowKey="operId"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={pagination}
        scroll={{ x: 1100 }}
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
              <Typography.Text strong>{t("loginlog.action")}: </Typography.Text>
              <Tag color={(actionMap[detail.businessType] ?? actionMap[6]).color}>
                {t((actionMap[detail.businessType] ?? actionMap[6]).labelKey)}
              </Tag>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.operUserName")}: </Typography.Text>
              <span>{detail.operUserName}</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.operIp")}: </Typography.Text>
              <span>{detail.operIp}</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.status")}: </Typography.Text>
              {detail.status === 0
                ? <Tag color="success">{t("operlog.statusSuccess")}</Tag>
                : <Tag color="error">{t("operlog.statusFail")}</Tag>}
            </div>
            <div>
              <Typography.Text strong>{t("operlog.errorMsg")}: </Typography.Text>
              <span>{detail.errorMsg || "—"}</span>
            </div>
            <div>
              <Typography.Text strong>{t("operlog.method")}: </Typography.Text>
              <span>{detail.method}</span>
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
          </div>
        )}
      </Drawer>
    </div>
  );
}
