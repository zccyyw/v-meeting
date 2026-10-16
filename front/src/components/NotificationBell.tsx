import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { sanitizeHtml } from "@/utils/sanitizeHtml";
import { Badge, Button, Empty, Modal, Popover, Tag, theme } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { MeetingApi, MeetingAppApi, SysNoticeMyApi, type MyInvitationItem, type MyNoticeItem, type NoticeItem } from "@/api/client";
import { formatMeetingCode, getJoinPrefs } from "@/auth/joinPrefs";
import { rememberJoin } from "@/auth/joinHistory";
import { getRoles } from "@/auth/session";
import { useInvitationsStream } from "@/hooks/useInvitationsStream";
import { showMessage } from "@/ui/toast";

/** 轮询间隔：SSE 实时推送为主，轮询作为兜底，保证通知最终可见。 */
const POLL_MS = 30_000;

/** 本地“已读”的邀请 id 集合，用于角标清零；“全部已读”即写入当前列表全部 id。 */
const READ_KEY = "meeting.notifyRead";

function loadReadIds(): Set<number> {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((n): n is number => typeof n === "number"));
  } catch {
    return new Set();
  }
}

function saveReadIds(ids: Set<number>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

/**
 * 站内通知：待加入会议。
 * 数据来源 GET /meetings/my-invitations（被群组/邀请人点名、尚未入会的会议）。
 * 点击“加入”复用 join-token 流程进入 /m/:id。
 */
export function NotificationBell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const [items, setItems] = useState<MyInvitationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [readIds, setReadIds] = useState<Set<number>>(() => loadReadIds());
  // 是否已完成首次拉取：避免首帧 items 为空时误清空本地已读记录
  const [loaded, setLoaded] = useState(false);
  // 审批红点：审批角色（admin / auth_admin）额外跟踪待审批数量
  const isApprover =
    getRoles().includes("admin") || getRoles().includes("auth_admin");
  const [pendingApprovals, setPendingApprovals] = useState(0);
  // 通知公告（全员公告 + 定向给我的通知）：已读状态在服务端
  const [notices, setNotices] = useState<MyNoticeItem[]>([]);
  const [noticeUnread, setNoticeUnread] = useState(0);
  const [noticeDetail, setNoticeDetail] = useState<NoticeItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await MeetingApi.myInvitations();
      setItems(res.items);
      setLoaded(true);
      if (isApprover) {
        try {
          const res = await MeetingAppApi.list({ status: "pending", page: 1, pageSize: 1 });
          setPendingApprovals(res.total);
        } catch {
          /* 静默失败：不影响邀请列表 */
        }
      }
    } catch {
      /* 静默失败：不影响主流程 */
    }
    // 通知公告与邀请相互独立，失败互不影响
    try {
      const res = await SysNoticeMyApi.list({ page: 1, pageSize: 20 });
      setNotices(res.items);
      setNoticeUnread(res.unreadCount);
    } catch {
      /* 静默失败 */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // 实时推送：订阅共享的“待加入会议变化”SSE，收到即刷新。
  // 断线由 EventSource 自动重连，上面的轮询作为兜底。
  useInvitationsStream(refresh);

  // 面板打开时刷新一次，保证信息最新
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // 清理已不在列表中的已读 id，避免 localStorage 无限增长
  useEffect(() => {
    if (!loaded) return;
    setReadIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(items.map((i) => i.invitationId));
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      if (!changed) return prev;
      saveReadIds(next);
      return next;
    });
  }, [items, loaded]);

  const unreadCount = items.reduce(
    (n, it) => n + (readIds.has(it.invitationId) ? 0 : 1),
    0,
  );

  function markRead(id: number) {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveReadIds(next);
      return next;
    });
  }

  function markAllRead() {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const it of items) next.add(it.invitationId);
      saveReadIds(next);
      return next;
    });
  }

  const localeTag = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";
  function fmtTime(iso: string | null): string {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString(localeTag, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  }

  async function onJoin(item: MyInvitationItem) {
    setBusyId(item.meetingId);
    try {
      const prefs = getJoinPrefs();
      const { token: joinToken } = await MeetingApi.joinToken(item.meetingId);
      rememberJoin(item.code, item.title);
      const sp = new URLSearchParams();
      sp.set("token", joinToken);
      sp.set("code", item.code);
      sp.set("mic", prefs.mic ? "1" : "0");
      sp.set("cam", prefs.cam ? "1" : "0");
      markRead(item.invitationId);
      setOpen(false);
      navigate(`/m/${item.meetingId}?${sp.toString()}`);
    } catch (err) {
      console.error(err);
      showMessage(t("notify.joinFailed"));
      setBusyId(null);
    }
  }

  async function openNoticeDetail(id: number) {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      // 服务端可见性校验 + 标记已读
      const detail = await SysNoticeMyApi.get(id);
      setNoticeDetail(detail);
      setNotices((prev) => prev.map((n) => (n.noticeId === id ? { ...n, read: 1 } : n)));
      setNoticeUnread((n) => Math.max(0, n - 1));
    } catch (err) {
      showMessage(t("notify.loadFailed"));
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  const content = (
    <div style={{ width: 320, maxHeight: 400, overflowY: "auto" }}>
      {isApprover && pendingApprovals > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "8px 4px",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <span>
            {t("notify.pendingApprovals")}（{pendingApprovals}）
          </span>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: "auto" }}
            onClick={() => navigate("/manager/meeting-approval")}
          >
            {t("notify.goApprove")}
          </Button>
        </div>
      )}
      {notices.length > 0 && (
        <div style={{ padding: "8px 4px 2px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 2 }}>
            {t("notice.pageTitle")}
          </div>
          {notices.map((n) => (
            <div
              key={n.noticeId}
              onClick={() => void openNoticeDetail(n.noticeId)}
              style={{
                padding: "6px 0", cursor: "pointer", borderRadius: 6,
                borderBottom: n === notices[notices.length - 1] ? "none" : `1px dashed ${token.colorBorderSecondary}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: n.read ? 0.55 : 1 }}
                  title={n.noticeTitle}
                >
                  {n.noticeTitle}
                </span>
                <Tag color={n.read ? "default" : "processing"} style={{ marginInlineEnd: 0 }}>
                  {n.read ? t("notice.read") : t("notice.unread")}
                </Tag>
              </div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, display: "flex", alignItems: "center", gap: 6 }}>
                <Tag color={n.noticeType === "1" ? "blue" : "orange"} style={{ marginInlineEnd: 0 }}>
                  {n.noticeType === "1" ? t("notice.typeNotice") : t("notice.typeAnnouncement")}
                </Tag>
                <span>{n.createTime}</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {items.length === 0 && notices.length === 0 && !(isApprover && pendingApprovals > 0) ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("notify.empty")}
        />
      ) : (
        items.map((item) => {
          const read = readIds.has(item.invitationId);
          return (
            <div
              key={item.invitationId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 4px",
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, opacity: read ? 0.55 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={item.title}
                  >
                    {item.title}
                  </span>
                  {item.meetingStatus === "live" && (
                    <Tag color="red" style={{ marginInlineEnd: 0 }}>
                      {t("notify.live")}
                    </Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  {item.hostName
                    ? `${t("notify.host")}: ${item.hostName} · `
                    : ""}
                  {formatMeetingCode(item.code)}
                </div>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  {fmtTime(item.scheduledAt) || fmtTime(item.invitedAt)}
                </div>
              </div>
              <Button
                type="primary"
                size="small"
                loading={busyId === item.meetingId}
                onClick={() => void onJoin(item)}
              >
                {t("notify.join")}
              </Button>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <>
      <Popover
      content={content}
      title={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span>{t("notify.title")}</span>
          {items.length > 0 && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: "auto" }}
              onClick={markAllRead}
            >
              {t("notify.markAllRead")}
            </Button>
          )}
        </div>
      }
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="rightBottom"
    >
      <Button
        type="text"
        aria-label={t("notify.title")}
        style={{ fontSize: 18 }}
      >
        <Badge count={unreadCount + (isApprover ? pendingApprovals : 0) + noticeUnread} size="small">
          <BellOutlined style={{ fontSize: 18 }} />
        </Badge>
      </Button>
    </Popover>
    <Modal
      open={detailOpen}
      title={noticeDetail?.noticeTitle}
      footer={null}
      onCancel={() => setDetailOpen(false)}
      loading={detailLoading}
      width={640}
      centered
    >
      {noticeDetail && (
        <div>
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
            <Tag color={noticeDetail.noticeType === "1" ? "blue" : "orange"} style={{ marginInlineEnd: 0 }}>
              {noticeDetail.noticeType === "1" ? t("notice.typeNotice") : t("notice.typeAnnouncement")}
            </Tag>
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
              {noticeDetail.createTime}
            </span>
          </div>
          {/* 富文本为管理端发布内容，展示前经 DOMPurify 白名单净化 */}
          <div
            className="notice-detail-content"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(noticeDetail.noticeContent) }}
          />
        </div>
      )}
    </Modal>
    </>
  );
}
