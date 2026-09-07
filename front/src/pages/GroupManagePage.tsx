import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button, Card, Input, Modal as AntModal, Popconfirm, Space, Table, Tag, Tooltip, Typography } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, ThunderboltOutlined, HomeOutlined, TeamOutlined, StarOutlined, StarFilled } from "@ant-design/icons";
import { MeetingGroupApi, type MeetingGroupItem } from "@/api/client";
import { MemberPicker, type MemberPickerValue } from "@/components/MemberPicker";
import { showMessage } from "@/ui/toast";

export function GroupManagePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<MeetingGroupItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editGroup, setEditGroup] = useState<MeetingGroupItem | null>(null);
  const [groupName, setGroupName] = useState("");
  const [memberValue, setMemberValue] = useState<MemberPickerValue>({ userIds: [], deptIds: [] });
  const [busy, setBusy] = useState(false);
  const [quickStartGroup, setQuickStartGroup] = useState<MeetingGroupItem | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickWaiting, setQuickWaiting] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await MeetingGroupApi.list();
      setGroups(res.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  function openCreate() {
    setGroupName("");
    setMemberValue({ userIds: [], deptIds: [] });
    setEditGroup(null);
    setCreateOpen(true);
  }

  function openEdit(group: MeetingGroupItem) {
    setEditGroup(group);
    setGroupName(group.groupName);
    setMemberValue({ userIds: [], deptIds: [] });
    setCreateOpen(true);
    // Load group detail to prefill members
    void MeetingGroupApi.get(group.groupId).then((detail) => {
      setMemberValue({
        userIds: detail.members.map((m) => m.userId),
        // 保留已有的部门成员 ID，编辑提交时会原样传递
        deptIds: detail.deptMembers.map((d) => d.deptId),
      });
    }).catch(() => {});
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!groupName.trim()) {
      showMessage(t("group.groupName") + " ?");
      return;
    }
    setBusy(true);
    try {
      if (editGroup) {
        // Edit mode: patch with diff
        const existing = await MeetingGroupApi.get(editGroup.groupId);
        const existingUserIds = new Set(existing.members.map((m) => m.userId));
        const existingDeptIds = new Set(existing.deptMembers.map((d) => d.deptId));
        const newUserIds = memberValue.userIds.filter((id) => !existingUserIds.has(id));
        const removeUserIds = [...existingUserIds].filter((id) => !memberValue.userIds.includes(id));
        const newDeptIds = memberValue.deptIds.filter((id) => !existingDeptIds.has(id));
        const removeDeptIds = [...existingDeptIds].filter((id) => !memberValue.deptIds.includes(id));

        await MeetingGroupApi.patch(editGroup.groupId, {
          groupName: groupName.trim() !== editGroup.groupName ? groupName.trim() : undefined,
          addUserIds: newUserIds.length ? newUserIds : undefined,
          removeUserIds: removeUserIds.length ? removeUserIds : undefined,
          addDeptIds: newDeptIds.length ? newDeptIds : undefined,
          removeDeptIds: removeDeptIds.length ? removeDeptIds : undefined,
        });
        showMessage(t("common.success"));
      } else {
        // Create mode
        await MeetingGroupApi.create({
          groupName: groupName.trim(),
          memberUserIds: memberValue.userIds.length ? memberValue.userIds : undefined,
          memberDeptIds: memberValue.deptIds.length ? memberValue.deptIds : undefined,
        });
        showMessage(t("common.success"));
      }
      setCreateOpen(false);
      await loadGroups();
    } catch {
      showMessage(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: number) {
    try {
      await MeetingGroupApi.remove(id);
      showMessage(t("common.success"));
      await loadGroups();
    } catch {
      showMessage(t("common.error"));
    }
  }

  async function onQuickStart() {
    if (!quickStartGroup) return;
    setBusy(true);
    try {
      const res = await MeetingGroupApi.quickStart(quickStartGroup.groupId, {
        title: quickTitle.trim() || undefined,
        waitingRoomEnabled: quickWaiting,
      });
      showMessage(t("group.invitedCount", { count: res.invitedCount }));
      setQuickStartGroup(null);
      setQuickTitle("");
      setQuickWaiting(false);
      // Navigate to meeting
      const { MeetingApi } = await import("@/api/client");
      const { token } = await MeetingApi.joinToken(res.meetingId);
      navigate(`/m/${res.meetingId}?token=${token}&code=${res.code}`);
    } catch {
      showMessage(t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function onTogglePin(group: MeetingGroupItem) {
    try {
      await MeetingGroupApi.pin(group.groupId, !group.pinned);
      await loadGroups();
    } catch {
      showMessage(t("common.error"));
    }
  }

  const columns = [
    {
      title: t("group.groupName"),
      dataIndex: "groupName",
      key: "groupName",
      render: (_: unknown, record: MeetingGroupItem) => (
        <Space size={6}>
          {record.pinned && (
            <Tag color="gold" icon={<StarFilled />} style={{ marginRight: 0 }}>
              {t("group.pinnedTag")}
            </Tag>
          )}
          <span>{record.groupName}</span>
        </Space>
      ),
    },
    {
      title: t("group.memberCount"),
      dataIndex: "memberCount",
      key: "memberCount",
      width: 100,
      render: (count: number) => <Tag color="blue">{count}</Tag>,
    },
    {
      title: t("group.createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (val: string) => new Date(val).toLocaleString(),
    },
    {
      title: t("common.actions"),
      key: "actions",
      width: 340,
      render: (_: unknown, record: MeetingGroupItem) => (
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            type="primary"
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={() => {
              setQuickStartGroup(record);
              setQuickTitle(record.groupName);
              setQuickWaiting(false);
            }}
          >
            {t("group.quickStart")}
          </Button>
          <Button
            size="small"
            icon={
              record.pinned ? (
                <StarFilled style={{ color: "#faad14" }} />
              ) : (
                <StarOutlined />
              )
            }
            onClick={() => void onTogglePin(record)}
          >
            {record.pinned ? t("group.unpin") : t("group.pin")}
          </Button>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
          >
            {t("group.edit")}
          </Button>
          <Popconfirm
            title={t("group.confirmDelete")}
            onConfirm={() => void onDelete(record.groupId)}
            okText={t("common.confirm")}
            cancelText={t("common.cancel")}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              {t("common.delete")}
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            <Space size={8}>
              <TeamOutlined />
              {t("group.title")}
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
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          {t("group.create")}
        </Button>
      </div>

      <Card className="admin-page-card">
        <Table
          columns={columns}
          dataSource={groups}
          rowKey="groupId"
          loading={loading}
          pagination={false}
          locale={{ emptyText: t("group.empty") }}
        />
      </Card>

      {/* Create / Edit Modal */}
      <AntModal
        open={createOpen}
        title={editGroup ? t("group.edit") : t("group.create")}
        onCancel={() => setCreateOpen(false)}
        footer={null}
        width={900}
        destroyOnHidden
      >
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: "1rem" }}>
            <label className="admin-antd-form-item-label" style={{ display: "block", marginBottom: "0.5rem" }}>
              <span style={{ color: "#ff4d4f", marginRight: 4 }}>*</span>
              {t("group.groupName")}
            </label>
            <Input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              maxLength={50}
              required
              autoFocus
              style={{ maxWidth: 400 }}
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
              {t("group.members")}
            </label>
            <MemberPicker
              value={memberValue}
              onChange={setMemberValue}
            />
          </div>
          <div style={{ textAlign: "right" }}>
            <Button onClick={() => setCreateOpen(false)} style={{ marginRight: "0.5rem" }}>
              {t("common.cancel")}
            </Button>
            <Button type="primary" htmlType="submit" loading={busy}>
              {t("common.confirm")}
            </Button>
          </div>
        </form>
      </AntModal>

      {/* Quick Start Modal */}
      <AntModal
        open={quickStartGroup != null}
        title={t("group.quickStart")}
        onCancel={() => setQuickStartGroup(null)}
        onOk={() => void onQuickStart()}
        okText={t("group.startNow")}
        cancelText={t("common.cancel")}
        confirmLoading={busy}
        destroyOnHidden
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              {t("group.meetingTitle")}
            </label>
            <Input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              maxLength={120}
              autoFocus
            />
          </div>
          <label className="checkbox" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              type="checkbox"
              checked={quickWaiting}
              onChange={(e) => setQuickWaiting(e.target.checked)}
            />
            {t("group.waitingRoom")}
          </label>
        </div>
      </AntModal>
    </div>
  );
}
