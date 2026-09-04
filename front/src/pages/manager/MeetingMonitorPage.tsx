import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  App as AntApp,
  Button,
  Card,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import {
  InvitationApi,
  type AttendeeDetail,
  type MeetingOnlineInfo,
} from "@/api/client";
import { apiErrorMessage } from "@/i18n/errorMessage";

const { Text } = Typography;

const STATUS_COLORS: Record<string, string> = {
  attended: "green",
  pending: "default",
  left: "orange",
  rejected: "red",
};

export function MeetingMonitorPage() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<MeetingOnlineInfo[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<number[]>([]);
  const [attendeeMap, setAttendeeMap] = useState<
    Record<number, AttendeeDetail[]>
  >({});
  const [attendeeLoading, setAttendeeLoading] = useState<Set<number>>(new Set());
  const [deptFilter, setDeptFilter] = useState<string | undefined>(undefined);
  const [searchText, setSearchText] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await InvitationApi.onlineMeetings();
      setItems(res.items);
    } catch (err: unknown) {
      message.error(apiErrorMessage(t, err));
    } finally {
      setLoading(false);
    }
  }, [t, message]);

  useEffect(() => {
    void fetchData();
    const timer = window.setInterval(fetchData, 10000);
    return () => window.clearInterval(timer);
  }, [fetchData]);

  const loadAttendees = useCallback(
    async (meetingId: number) => {
      setAttendeeLoading((prev) => new Set(prev).add(meetingId));
      try {
        const res = await InvitationApi.attendeeDetail(meetingId);
        setAttendeeMap((prev) => ({ ...prev, [meetingId]: res.items }));
      } catch (err: unknown) {
        message.error(apiErrorMessage(t, err));
      } finally {
        setAttendeeLoading((prev) => {
          const next = new Set(prev);
          next.delete(meetingId);
          return next;
        });
      }
    },
    [t, message],
  );

  const handleExpand = (expanded: boolean, record: MeetingOnlineInfo) => {
    if (expanded) {
      setExpandedKeys((prev) => [...prev, record.meetingId]);
      if (!attendeeMap[record.meetingId]) {
        void loadAttendees(record.meetingId);
      }
    } else {
      setExpandedKeys((prev) => prev.filter((k) => k !== record.meetingId));
    }
  };

  // 收集所有部门选项
  const deptOptions = (() => {
    const map = new Map<string, string>();
    Object.values(attendeeMap).forEach((list) => {
      list.forEach((a) => {
        if (a.deptId != null && a.deptName) {
          map.set(String(a.deptId), a.deptName);
        }
      });
    });
    return Array.from(map.entries()).map(([value, label]) => ({
      value,
      label,
    }));
  })();

  // 按搜索文本和部门筛选会议列表
  const filteredItems = items.filter((m) => {
    if (searchText) {
      const q = searchText.toLowerCase();
      if (
        !m.title.toLowerCase().includes(q) &&
        !m.code.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const columns: ColumnsType<MeetingOnlineInfo> = [
    {
      title: t("meetingMonitor.code", "会议码"),
      dataIndex: "code",
      key: "code",
      width: 120,
      render: (code: string) => <Text copyable>{code}</Text>,
    },
    {
      title: t("meetingMonitor.title", "会议标题"),
      dataIndex: "title",
      key: "title",
      ellipsis: true,
    },
    {
      title: t("meetingMonitor.status", "状态"),
      dataIndex: "status",
      key: "status",
      width: 100,
      render: () => (
        <Tag color="green">{t("meetingMonitor.live", "进行中")}</Tag>
      ),
    },
    {
      title: t("meetingMonitor.onlineCount", "在线人数"),
      dataIndex: "onlineCount",
      key: "onlineCount",
      width: 120,
      render: (n: number, record: MeetingOnlineInfo) => (
        <Space>
          <Tag color="blue">{n}</Tag>
          <Text type="secondary">/{record.invitedCount || 0}</Text>
        </Space>
      ),
    },
    {
      title: t("meetingMonitor.actions", "操作"),
      key: "actions",
      width: 120,
      render: (_: unknown, record: MeetingOnlineInfo) => (
        <Button
          type="link"
          size="small"
          onClick={() => navigate(`/m/${record.meetingId}`)}
        >
          {t("meetingMonitor.join", "进入")}
        </Button>
      ),
    },
  ];

  const attendeeColumns: ColumnsType<AttendeeDetail> = [
    {
      title: t("meetingMonitor.displayName", "姓名"),
      dataIndex: "displayName",
      key: "displayName",
      width: 120,
    },
    {
      title: t("meetingMonitor.dept", "部门"),
      key: "deptName",
      width: 150,
      render: (_: unknown, r: AttendeeDetail) =>
        r.deptName ?? <Text type="secondary">-</Text>,
    },
    {
      title: t("meetingMonitor.attendeeStatus", "状态"),
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status: string) => (
        <Tag color={STATUS_COLORS[status] || "default"}>
          {t(`meetingMonitor.status_${status}`, status)}
        </Tag>
      ),
    },
    {
      title: t("meetingMonitor.joinedAt", "加入时间"),
      dataIndex: "joinedAt",
      key: "joinedAt",
      width: 180,
      render: (joinedAt: string | null) =>
        joinedAt
          ? new Date(joinedAt).toLocaleString()
          : <Text type="secondary">-</Text>,
    },
  ];

  return (
    <Card
      title={
        <Space>
          <span>{t("meetingMonitor.title2", "会议在线监控")}</span>
          <Tag color="blue">{filteredItems.length}</Tag>
        </Space>
      }
      extra={
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder={t("meetingMonitor.searchPlaceholder", "搜索会议码/标题")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
          />
          <Select
            allowClear
            placeholder={t("meetingMonitor.deptFilter", "按部门筛选")}
            value={deptFilter}
            onChange={setDeptFilter}
            options={deptOptions}
            style={{ width: 160 }}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void fetchData()}
            loading={loading}
          >
            {t("common.refresh", "刷新")}
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={filteredItems}
        rowKey="meetingId"
        loading={loading}
        pagination={false}
        size="middle"
        expandable={{
          expandedRowKeys: expandedKeys,
          onExpand: handleExpand,
          expandedRowRender: (record) => {
            const list = attendeeMap[record.meetingId] || [];
            const filtered = deptFilter
              ? list.filter((a) => String(a.deptId) === deptFilter)
              : list;
            return (
              <Table
                columns={attendeeColumns}
                dataSource={filtered}
                rowKey={(r) => `${r.displayName}-${r.status}`}
                loading={attendeeLoading.has(record.meetingId)}
                pagination={false}
                size="small"
                locale={{
                  emptyText: t("meetingMonitor.noAttendees", "暂无参会者"),
                }}
              />
            );
          },
        }}
        locale={{
          emptyText: t("meetingMonitor.noOnline", "当前无在线会议"),
        }}
      />
    </Card>
  );
}
