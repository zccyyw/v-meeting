import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Badge, Button, Empty, Popover, Tag, theme } from "antd";
import { BellOutlined } from "@ant-design/icons";
import { MeetingApi, type MyInvitationItem } from "@/api/client";
import { formatMeetingCode, getJoinPrefs } from "@/auth/joinPrefs";
import { rememberJoin } from "@/auth/joinHistory";
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

  const refresh = useCallback(async () => {
    try {
      const res = await MeetingApi.myInvitations();
      setItems(res.items);
      setLoaded(true);
    } catch {
      /* 静默失败：不影响主流程 */
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

  const content = (
    <div style={{ width: 320, maxHeight: 400, overflowY: "auto" }}>
      {items.length === 0 ? (
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
        <Badge count={unreadCount} size="small">
          <BellOutlined style={{ fontSize: 18 }} />
        </Badge>
      </Button>
    </Popover>
  );
}
