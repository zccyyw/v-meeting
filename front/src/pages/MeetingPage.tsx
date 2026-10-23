import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CopyOutlined,
  CheckOutlined,
  SettingOutlined,
  DownOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  LayoutOutlined,
  ToolOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { MeetingApi, RecordingsApi, InvitationApi, type InvitationItem } from "@/api/client";
import { copyText, formatMeetingCode } from "@/auth/joinPrefs";
import { getSessionId } from "@/auth/session";
import { Controls } from "@/components/Controls";
import { ChatPanel } from "@/components/ChatPanel";
import { DanmuOverlay } from "@/components/DanmuOverlay";
import { HostControls } from "@/components/HostControls";
import { Modal } from "@/components/Modal";
import { VideoGrid, type LayoutCols } from "@/components/VideoGrid";
import { WaitingRoom } from "@/components/WaitingRoom";
import { MediaRoom, type MediaRoomSnapshot } from "@/media/room";
import { InvitationPanel } from "@/components/InvitationPanel";
import { FloatingPanel } from "@/components/FloatingPanel";
import { useActiveSpeaker, type ActiveSpeakerSource } from "@/hooks/useActiveSpeaker";
import { useIsNarrow } from "@/hooks/useIsNarrow";
import { useChromeAutoHide } from "@/hooks/useChromeAutoHide";
import { useRecorder } from "@/hooks/useRecorder";
import { SignalClient } from "@/signal/client";
import { showMessage } from "@/ui/toast";
import type { RecorderSource } from "@/media/recorder";
import { App as AntApp, ConfigProvider, Dropdown, Popover } from "antd";
import { MEETING_DARK_OVERLAY_THEME } from "@/theme/meetingOverlayTheme";

/** 宫格布局"一屏N等分"可选档位（对齐腾讯会议：3/6/9/12，默认 9） */
const GRID_DIVISIONS = [3, 6, 9, 12] as const;

/** 画面轮播间隔可选档位（ms），房间级：主持人选定后广播全员 */
const ROTATION_INTERVALS = [5_000, 10_000, 20_000, 30_000, 60_000] as const;

/**
 * 参会时长计时存储（模块级）：
 * 计时彻底独立于组件钩子链——会议组件钩子数量庞大（i18n/router/媒体房间等
 * 内部钩子混杂），曾出现外层 state 推进但渲染文本冻结的问题；改为外部存储 +
 * useSyncExternalStore 后，消费者以快照读取，计时不受组件渲染影响。
 */
const joinDurationStore = (() => {
  let elapsed = 0;
  let startedAt: number | null = null;
  let timer: number | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    /** 入会时启动计时（重复调用幂等） */
    start() {
      if (startedAt == null) startedAt = Date.now();
      if (timer != null) return;
      timer = window.setInterval(() => {
        elapsed = Math.floor((Date.now() - (startedAt ?? Date.now())) / 1000);
        emit();
      }, 1000);
    },
    /** 离会时停止并归零 */
    stop() {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
      startedAt = null;
      elapsed = 0;
      emit();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => elapsed,
  };
})();

/**
 * 主持人工具菜单项左侧的"√"槽位：
 * 固定宽度保证勾选/未勾选时文字左缘对齐，未选中仅隐藏 √（占位保留）。
 */
function hostMenuCheck(on: boolean) {
  return (
    <span className={`host-menu-check${on ? " is-on" : ""}`}>
      <CheckOutlined aria-hidden />
    </span>
  );
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const emptySnapshot: MediaRoomSnapshot = {
  status: "idle",
  peerId: null,
  role: null,
  displayName: "",
  waitingPeers: [],
  peers: [],
  localStream: null,
  localScreenStream: null,
  remoteStreams: new Map(),
  screenStreams: new Map(),
  screenAudioStreams: new Map(),
  micEnabled: true,
  camEnabled: false,
  handRaised: false,
  layout: "grid",
  rotationIntervalMs: 20_000,
  sideListLayout: "embed",
  focusPeerId: null,
  sharingScreen: false,
  canShare: true,
  allowShare: true,
  waitingRoomEnabled: false,
  peerRtt: {},
  rotationEnabled: false,
  sideListVisible: true,
  locked: false,
  hideCode: false,
  chatAllowed: true,
  selfUnmuteAllowed: true,
  raiseHandAllowed: true,
  reactionAllowed: true,
  layoutSwitchAllowed: true,
  danmuEnabled: false,
  allMuted: false,
  recordAllowed: false,
  chatMessages: [],
  error: null,
  warning: null,
  localMediaError: null,
  endedReason: null,
};

function MeetingPageInner() {
  const { t } = useTranslation();
  const { meetingId = "" } = useParams();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();

  const displayName =
    params.get("name")?.trim() ||
    localStorage.getItem("displayName")?.trim() ||
    "Guest";

  const micParam = params.get("mic");
  const camParam = params.get("cam");
  const initialMic = micParam == null ? true : micParam === "1";
  const initialCam = camParam == null ? false : camParam === "1";

  const [snap, setSnap] = useState<MediaRoomSnapshot>(emptySnapshot);
  // 全屏状态：fullscreenchange 事件同步（含浏览器 ESC 退出）
  const [isFullscreen, setIsFullscreen] = useState(() => !!document.fullscreenElement);
  // 成员画面轮换间隔已升级为房间级（主持人工具选定，信令广播全员），见 snap.rotationIntervalMs
  useEffect(() => {
    const sync = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  function toggleFullscreen(): void {
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {});
      } else {
        void document.documentElement.requestFullscreen?.().catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }

  /** 返回首页：会议结束/被踢/主动离开时自动退出全屏（若处于全屏） */
  function goHome(opts?: { replace?: boolean }): void {
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {});
      }
    } catch {
      /* ignore */
    }
    navigate("/", opts);
  }
  // 非阻断警示（黄横幅）10 秒自动消散：记录已隐藏的警示内容，
  // 新内容出现时重新显示；清空时复位
  const [warningDismissed, setWarningDismissed] = useState<string | null>(null);
  // 沉浸态跟随浏览器全屏：全屏中 header/controls 浮化为 overlay 并自动隐藏；
  // 退出全屏恢复普通态（始终显示）。首次进入会议自动请求全屏（见下方 effect）。
  const [isImmersive, setIsImmersive] = useState(false);
  const chromeVisible = useChromeAutoHide(isImmersive);
  useEffect(() => {
    if (!snap.warning) {
      setWarningDismissed(null);
      return;
    }
    setWarningDismissed(null);
    const timer = setTimeout(() => setWarningDismissed(snap.warning), 10_000);
    return () => clearTimeout(timer);
  }, [snap.warning]);

  // 全屏状态同步：进入/退出浏览器全屏时切换沉浸态；退出时强制恢复 chrome 可见
  const [membersOpen, setMembersOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // 浮窗打开顺序（早→晚）：决定成员/聊天左右排布，先开者在最右；关闭再打开会重新排队
  const [openOrder, setOpenOrder] = useState<("members" | "chat")[]>([]);
  const isNarrow = useIsNarrow();
  // 已被拖走（脱离自动排布）的浮窗；关闭后重置，重新打开会再次自动停靠
  const [detached, setDetached] = useState<Set<"members" | "chat">>(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteListOpen, setInviteListOpen] = useState(false);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [allMuted, setAllMuted] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);

  // —— 本地偏好（localStorage 持久化，仅自己生效） ——
  const [showActiveSpeaker, setShowActiveSpeaker] = useState(
    () => localStorage.getItem("meeting.showActiveSpeaker") !== "0",
  );
  const [showJoinDuration, setShowJoinDuration] = useState(
    () => localStorage.getItem("meeting.showJoinDuration") === "1",
  );
  // 布局子型（本地偏好，仅自己生效）
  // 演讲者布局的成员列表形态：房间级（信令广播全员跟随），不再用本地偏好
  const sideListLayout = snap.sideListLayout;
  const [onlyShowSpeakers, setOnlyShowSpeakers] = useState(
    () => localStorage.getItem("meeting.onlyShowSpeakers") === "1",
  );
  // —— 正在讲话检测：本地电平判定 ——
  const audioSources: ActiveSpeakerSource[] = [
    { peerId: "local", stream: snap.localStream },
    ...[...snap.remoteStreams].map(([pid, st]) => ({ peerId: pid, stream: st })),
  ];
  const audioSourcesKey =
    audioSources.map((a) => a.peerId).join(",") + (snap.micEnabled ? "+self" : "") +
    "|" + [...snap.remoteStreams].map(([pid, st]) => pid + ":" + String(st.getAudioTracks().length)).join(",");
  const { activePeerId: activeSpeakerId, activeSpeakers } = useActiveSpeaker(audioSources, showActiveSpeaker, audioSourcesKey);
  const activeSpeakerName =
    activeSpeakerId === "local"
      ? displayName
      : snap.peers.find((p) => p.peerId === activeSpeakerId)?.displayName ?? null;
  // 弹幕全局化：开关在主持人工具中，由信令广播（snap.danmuEnabled），不再有本地开关
  // 宫格"一屏N等分"：本地偏好，仅自己生效（localStorage 持久化）
  const [layoutCols, setLayoutCols] = useState<LayoutCols>(function (init) {
    const n = Number(init);
    return n === 3 || n === 6 || n === 12 ? (n as LayoutCols) : 9;
  }(localStorage.getItem("meeting.layoutCols") || "9"));
  const [danmuItems, setDanmuItems] = useState<
    { id: number; text: string; self: boolean }[]
  >([]);
  const danmuIdRef = useRef(0);
  const lastChatLenRef = useRef(0);
  const lastRecordingPeersRef = useRef<Set<string>>(new Set());
  /** 已建立录制基线的入会会话（peerId）；重连会换 peerId，需要重新建立基线 */
  const recordingBaselinePeerRef = useRef<string | null>(null);
  const [meetingCode, setMeetingCode] = useState(
    () => params.get("code")?.replace(/\D/g, "") ?? "",
  );
  const [meetingTitle, setMeetingTitle] = useState(() => t("meeting.title"));
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  /** 共享内容声音本端静音（纯本地状态，不影响其他成员，也不经信令） */
  const [screenAudioMuted, setScreenAudioMuted] = useState(false);
  const [audioId, setAudioId] = useState("");
  const [videoId, setVideoId] = useState("");
  // 本地录制生命周期（P1-7 拆分）：状态/计时/start/stop/discard
  const recorder = useRecorder();
  const roomRef = useRef<MediaRoom | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const autoShareTried = useRef(false);

  const wantAutoShare = params.get("share") === "1";

  // 窄屏互斥：进入窄屏后若两者都打开，仅保留最近打开的一个
  useEffect(() => {
    if (!isNarrow || !membersOpen || !chatOpen) return;
    const last = openOrder[openOrder.length - 1];
    if (last === "members") setChatOpen(false);
    else setMembersOpen(false);
  }, [isNarrow, membersOpen, chatOpen, openOrder]);



  // 监听他人录制状态变化 -> Toast + 聊天系统消息
  useEffect(() => {
    const prev = lastRecordingPeersRef.current;
    const current = new Set(
      snap.peers.filter((p) => p.recording && p.peerId !== snap.peerId).map((p) => p.peerId),
    );
    // 入会（或重连换 peerId）后的首个快照只建立基线：服务端快照会带上"入会前
    // 就已开始的录制"，这属于既有状态而非新事件，不应补发提示。
    if (recordingBaselinePeerRef.current !== snap.peerId) {
      recordingBaselinePeerRef.current = snap.peerId;
      lastRecordingPeersRef.current = current;
      return;
    }
    // 新开始录制的
    for (const peerId of current) {
      if (!prev.has(peerId)) {
        const p = snap.peers.find((x) => x.peerId === peerId);
        const name = p?.displayName ?? t("meeting.peer");
        showMessage(t("meeting.recordingStartedBy", { name }));
      }
    }
    // 停止录制的
    for (const peerId of prev) {
      if (!current.has(peerId)) {
        const p = snap.peers.find((x) => x.peerId === peerId);
        const name = p?.displayName ?? t("meeting.peer");
        showMessage(t("meeting.recordingStoppedBy", { name }));
      }
    }
    lastRecordingPeersRef.current = current;
  }, [snap.peers, snap.peerId, t]);

  useEffect(() => {
    document.body.classList.add("meeting-active");
    return () => document.body.classList.remove("meeting-active");
  }, []);

  useEffect(() => {
    if (snap.status !== "ended") return;
    // Active leave already navigates home; only meeting end / remote end.
    if (snap.endedReason === "left") return;
    showMessage(t("meeting.ended"));
    goHome({ replace: true });
  }, [snap.status, snap.endedReason, navigate, t]);

  useEffect(() => {
    const len = snap.chatMessages.length;
    const prev = lastChatLenRef.current;
    if (len <= prev) {
      lastChatLenRef.current = len;
      return;
    }
    const newMsgs = snap.chatMessages.slice(prev);
    lastChatLenRef.current = len;

    if (!chatOpen) {
      setUnreadChat((n) => n + newMsgs.length);
    }

    if (snap.danmuEnabled) {
      const items = newMsgs.map((m) => ({
        id: ++danmuIdRef.current,
        text: `${m.displayName}: ${m.text}`,
        self: snap.peerId != null && m.peerId === snap.peerId,
      }));
      setDanmuItems((prevItems) => [...prevItems, ...items].slice(-30));
    }
  }, [snap.chatMessages, chatOpen, snap.danmuEnabled, snap.peerId]);

  useEffect(() => {
    if (!wantAutoShare) return;
    if (snap.status !== "joined") return;
    if (autoShareTried.current) return;
    autoShareTried.current = true;

    // Drop share flag so refresh won't re-prompt.
    const next = new URLSearchParams(params);
    next.delete("share");
    const qs = next.toString();
    navigate(
      qs ? `/m/${meetingId}?${qs}` : `/m/${meetingId}`,
      { replace: true },
    );

    void roomRef.current
      ?.startScreenShare()
      .catch((err) => {
      console.error(err);
      const name =
        err && typeof err === "object" && "name" in err
          ? String((err as { name: unknown }).name)
          : "";
      // User dismissed the browser picker — stay in meeting quietly.
      if (name === "NotAllowedError" || name === "AbortError") return;
      showMessage(t("meeting.shareFailed"));
    });
  }, [wantAutoShare, snap.status, params, navigate, meetingId, t]);

  useEffect(() => {
    if (!token) return;

    setAllMuted(false);

    const signal = new SignalClient();
    const room = new MediaRoom({
      signal,
      token,
      displayName,
      micEnabled: initialMic,
      camEnabled: initialCam,
    });
    roomRef.current = room;

    const unsub = room.subscribe(() => {
      setSnap(room.getSnapshot());
    });
    setSnap(room.getSnapshot());

    void room.join().catch((err) => {
      console.error(err);
      setSnap(room.getSnapshot());
    });

    return () => {
      // 离开会议时停止录制
      recorder.discard();
      unsub();
      room.leave();
      signal.close();
      roomRef.current = null;
    };
  }, [token, displayName, initialMic, initialCam]);

  useEffect(() => {
    let cancelled = false;
    const fromQuery = params.get("code")?.replace(/\D/g, "") ?? "";
    if (fromQuery.length === 9) {
      setMeetingCode(fromQuery);
      return;
    }
    if (!meetingId) return;
    // 该接口需要登录会话；访客（无会话）请求必然 401 且会议号仅用于展示
    // （可由 URL ?code= 提供），无会话时直接跳过，避免控制台 401 噪音。
    if (!getSessionId()) return;

    void MeetingApi.get(meetingId)
      .then((m) => {
        if (cancelled) return;
        setMeetingCode(m.code);
        if (m.title) setMeetingTitle(m.title);
      })
      .catch(() => {
        /* keep empty code */
      });

    return () => {
      cancelled = true;
    };
  }, [meetingId, params]);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const audios = devices.filter((d) => d.kind === "audioinput");
        const videos = devices.filter((d) => d.kind === "videoinput");
        setAudioInputs(audios);
        setVideoInputs(videos);
        // 当前选中设备被拔出/禁用时自动切到可用设备（媒体轨由 room 层自愈重采）
        setAudioId((prev) =>
          prev && audios.some((d) => d.deviceId === prev) ? prev : audios[0]?.deviceId || "",
        );
        setVideoId((prev) =>
          prev && videos.some((d) => d.deviceId === prev) ? prev : videos[0]?.deviceId || "",
        );
      } catch {
        /* permission may be pending */
      }
    }

    void refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  // 获取邀请名单（成员面板打开时加载，peers 变化时刷新，定时刷新以更新在线状态）
  // 仅主持人请求：邀请名单接口仅主持人/管理角色可访问，成员请求必然 403，
  // 且成员视图本就不展示被邀请未入会人员。
  useEffect(() => {
    if ((!membersOpen && !inviteListOpen) || !meetingId) return;
    if (snap.role !== "host") return;
    // 立即加载一次
    void InvitationApi.list(Number(meetingId))
      .then((res) => setInvitations(res.items))
      .catch(() => { /* ignore */ });
    // 定时刷新（每 5 秒），确保在线状态及时更新
    const timer = window.setInterval(() => {
      void InvitationApi.list(Number(meetingId))
        .then((res) => setInvitations(res.items))
        .catch(() => { /* ignore */ });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [membersOpen, inviteListOpen, meetingId, snap.peers.length, snap.role]);

  useEffect(() => {
    if (!settingsOpen) return;

    function onPointerDown(e: MouseEvent) {
      const el = settingsRef.current;
      if (el && !el.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [settingsOpen]);

  async function handleCopyCode() {
    if (!meetingCode) return;
    const ok = await copyText(meetingCode);
    if (ok) {
      setCopyHint(t("meeting.copied"));
      window.setTimeout(() => setCopyHint(null), 1500);
    }
  }

  async function flashCopied() {
    setCopyHint(t("meeting.copied"));
    window.setTimeout(() => setCopyHint(null), 1500);
  }

  async function handleCopyLink() {
    if (!meetingCode) return;
    const link = `${window.location.origin}/?join=${meetingCode}`;
    const ok = await copyText(link);
    if (ok) await flashCopied();
  }

  async function handleCopyAll() {
    if (!meetingCode) return;
    const link = `${window.location.origin}/?join=${meetingCode}`;
    const body = t("meeting.inviteBody", {
      title: meetingTitle,
      code: meetingCode,
      link,
    });
    const ok = await copyText(body);
    if (ok) await flashCopied();
  }

  // 注意：以下钩子必须位于任何条件 return（如缺 token 的早退）之前，
  // 否则构成条件钩子（React 规则违规），会导致钩子状态/副作用异常。
  const inMeeting = snap.status === "joined";

  // 沉浸态：跟随浏览器全屏状态
  useEffect(() => {
    const onFsChange = () => setIsImmersive(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onFsChange);
    onFsChange();
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // 首次进入会议自动全屏。页面加载时无用户手势，requestFullscreen 会被
  // 浏览器拒绝 → 降级为监听首次 pointerdown/keydown（有手势上下文）再请求。
  // Esc 退出后不自动重新拉全屏（退出全屏=普通态，始终显示上下区域）。
  useEffect(() => {
    if (!inMeeting || document.fullscreenElement) return;
    document.documentElement.requestFullscreen?.().catch(() => {
      const enterFs = () => {
        document.documentElement.requestFullscreen?.().catch(() => {});
      };
      document.addEventListener("pointerdown", enterFs, { once: true });
      document.addEventListener("keydown", enterFs, { once: true });
    });
  }, [inMeeting]);

  // 入会凭证/会议终结类错误（invalid_token / meeting_ended / room_closed）：
  // 自动回首页（replace 防后退回到错误页）。若登录会话也已失效（服务整体
  // 重启），首页数据请求会触发 401 全局拦截自动跳登录页——两种重启场景
  // 都落到正确归宿。ref 防同一错误重复弹 toast/跳转。
  const handledTerminalErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const err = snap.error;
    if (
      err !== "invalid_token" &&
      err !== "meeting_ended" &&
      err !== "room_closed"
    ) {
      return;
    }
    if (handledTerminalErrorRef.current === err) return;
    handledTerminalErrorRef.current = err;
    showMessage(
      err === "invalid_token"
        ? t("meeting.invalidTokenHint")
        : t("meeting.meetingEndedHint"),
    );
    // 退出全屏（若处于）并以 replace 回首页，防止后退回到错误会议页
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {});
      }
    } catch {
      /* ignore */
    }
    navigate("/", { replace: true });
    // ref 防同一错误重复处理；showMessage 为 App 实例稳定引用（不列入）
  }, [snap.error, navigate, t]);

  // 参会时长：模块级存储 + useSyncExternalStore（仅追加钩子，不移动既有槽位）
  const joinElapsed = useSyncExternalStore(joinDurationStore.subscribe, joinDurationStore.get);
  useEffect(() => {
    if (inMeeting) joinDurationStore.start();
    else joinDurationStore.stop();
  }, [inMeeting]);

  // —— 表情反应气泡 ——
  const [reactions, setReactions] = useState<{ id: number; peerId: string; emoji: string }[]>([]);
  const reactionIdRef = useRef(0);
  const reactionTimerRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    const room = roomRef.current;
    if (!room || !inMeeting) return;
    room.emitReaction = (peerId, emoji) => {
      const id = ++reactionIdRef.current;
      setReactions((prev) => [...prev, { id, peerId, emoji }]);
      const timer = window.setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== id));
        reactionTimerRef.current.delete(id);
      }, 2600);
      reactionTimerRef.current.set(id, timer);
    };
    return () => {
      for (const timer of reactionTimerRef.current.values()) window.clearTimeout(timer);
      reactionTimerRef.current.clear();
      if (roomRef.current) roomRef.current.emitReaction = undefined;
    };
  }, [inMeeting]);

  if (!token) {
    return (
      <main className="page">
        <h1>{t("meeting.missingToken")}</h1>
        <p className="muted">{t("meeting.missingTokenHint")}</p>
        <p>
          <Link to="/">{t("meeting.backHome")}</Link>
        </p>
      </main>
    );
  }

  const selfWaiting = snap.status === "waiting";
  const isHost = snap.role === "host";
  // 主持人始终可录制；普通参会者需主持人开启"开启录制"
  const canRecord = isHost || snap.recordAllowed;
  const reactionName = (peerId: string) =>
    peerId === snap.peerId ? displayName : snap.peers.find((p) => p.peerId === peerId)?.displayName ?? null;



  const buildRecorderSources = (): RecorderSource[] => {
    const sources: RecorderSource[] = [];
    // 本地摄像头
    if (snap.localStream) {
      sources.push({
        key: `local-${snap.peerId ?? "me"}`,
        label: `${snap.displayName}（${t("meeting.me")})`,
        video: snap.localStream.getVideoTracks()[0] ?? null,
        audio: snap.localStream.getAudioTracks()[0] ?? null,
      });
    }
    // 远端
    for (const [peerId, stream] of snap.remoteStreams) {
      const peer = snap.peers.find((p) => p.peerId === peerId);
      sources.push({
        key: `remote-${peerId}`,
        label: peer?.displayName ?? peerId,
        video: stream.getVideoTracks()[0] ?? null,
        audio: stream.getAudioTracks()[0] ?? null,
      });
    }
    // 屏幕共享（本地 + 远端）
    if (snap.localScreenStream) {
      sources.push({
        key: `screen-local`,
        label: t("meeting.share"),
        video: snap.localScreenStream.getVideoTracks()[0] ?? null,
        audio: null,
      });
    }
    for (const [peerId, stream] of snap.screenStreams) {
      const peer = snap.peers.find((p) => p.peerId === peerId);
      sources.push({
        key: `screen-${peerId}`,
        label: `${peer?.displayName ?? peerId} ${t("meeting.share")}`,
        video: stream.getVideoTracks()[0] ?? null,
        audio: null,
      });
    }
    return sources;
  };

  const handleToggleRecord = () => {
    if (!recorder.recording && !canRecord) {
      showMessage(t("meeting.recordDisabledByHost"));
      return;
    }
    if (recorder.recording) {
      // 停止并上传（先通知信令再停止，顺序与原实现一致）
      roomRef.current?.notifyRecordingStopped();
      void recorder.stop().then(async (res) => {
        if (!res) return;
        showMessage(t("meeting.recordingSaving"));
        try {
          await RecordingsApi.upload(res.blob, {
            title: `${meetingTitle}-${new Date().toLocaleString()}`,
            meetingId: meetingId ? Number(meetingId) : null,
            durationMs: res.durationMs,
          });
          showMessage(t("meeting.recordingSaved"));
        } catch (err) {
          console.error("upload recording failed", err);
          showMessage(t("meeting.recordingSaveFailed"));
        }
      });
      return;
    }
    // 开始录制
    if (recorder.start(buildRecorderSources)) {
      roomRef.current?.notifyRecordingStarted();
      showMessage(t("meeting.recordingStarted"));
    } else {
      showMessage(t("meeting.recordingStartFailed"));
    }
  };
  function openPanel(key: "members" | "chat") {
    if (key === "members") {
      setMembersOpen(true);
      // 窄屏互斥：同一个显示位，开一个自动关另一个（用按钮切换）
      if (isNarrow) setChatOpen(false);
    } else {
      setChatOpen(true);
      if (isNarrow) setMembersOpen(false);
    }
    setOpenOrder((o) => [...o.filter((k) => k !== key), key]);
    // 重新打开即回到自动停靠（清除上次的"拖走"状态）
    setDetached((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }

  function closePanel(key: "members" | "chat") {
    if (key === "members") setMembersOpen(false);
    else setChatOpen(false);
    setOpenOrder((o) => o.filter((k) => k !== key));
    setDetached((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }

  function detachPanel(key: "members" | "chat") {
    setDetached((s) => {
      if (s.has(key)) return s;
      const next = new Set(s);
      next.add(key);
      return next;
    });
  }

  function toggleMembers() {
    if (membersOpen) closePanel("members");
    else openPanel("members");
  }

  function toggleChat() {
    if (chatOpen) {
      closePanel("chat");
    } else {
      setUnreadChat(0);
      openPanel("chat");
    }
  }

  const roleLabel =
    snap.role === "host"
      ? t("meeting.roleHost")
      : snap.role
        ? t("meeting.roleParticipant")
        : "";
  // 主持人关闭"允许成员切换本地布局"后，成员的布局浮窗整体只读（本地偏好仍生效，仅不能改）
  const layoutLocked = inMeeting && !isHost && !snap.layoutSwitchAllowed;
  const inviteLink = meetingCode
    ? `${window.location.origin}/?join=${meetingCode}`
    : "";

  // 浮窗排布：先开者在最右，后开者依次往左（右距 = 20 + 序号×(310+8)）；
  // 窄屏只有单个显示位，仅渲染最右（唯一）那个。
  const openKeys: ("members" | "chat")[] = [];
  if (membersOpen) openKeys.push("members");
  if (chatOpen) openKeys.push("chat");
  const orderedKeys = [...openOrder.filter((k) => openKeys.includes(k))];
  for (const k of openKeys) if (!orderedKeys.includes(k)) orderedKeys.push(k);
  // 仅未拖走的浮窗参与自动排布：先开者在最右，其余依序往左补位
  const dockedKeys = orderedKeys.filter((k) => !detached.has(k));
  const slotFor = (key: "members" | "chat") => {
    const i = dockedKeys.indexOf(key);
    return i <= 0 ? 20 : 20 + i * (310 + 8);
  };
  const showMembersPanel =
    membersOpen && (!isNarrow || orderedKeys[0] === "members");
  const showChatPanel = chatOpen && (!isNarrow || orderedKeys[0] === "chat");

  return (
    <main
      className={`meeting-page${isImmersive ? " is-immersive" : ""}${
        isImmersive && !chromeVisible ? " chrome-hidden" : ""
      }`}
    >
      <div className="meeting-stage">
        {inMeeting && showActiveSpeaker && activeSpeakerName && (
          <div className="active-speaker" role="status">
            <span className="active-speaker-dot" aria-hidden />
            <span>{t("meeting.activeSpeaker")}:</span>
            <strong>{activeSpeakerName}</strong>
          </div>
        )}
        {reactions.length > 0 && (
          <div className="reaction-overlay" aria-hidden>
            {reactions.map((r) => (
              <div key={r.id} className="reaction-bubble">
                <span className="reaction-emoji-bubble">{r.emoji}</span>
                <span className="reaction-name">{reactionName(r.peerId) ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      <header className="meeting-header">
        <div className="meeting-header-info">
          <ConfigProvider theme={MEETING_DARK_OVERLAY_THEME}>
          <Popover
            placement="bottomLeft"
            content={(
              <div className="meeting-detail-panel">
                <div className="meeting-detail-row"><span>{t("meeting.detailTitle")}</span><strong>{meetingTitle}</strong></div>
                <div className="meeting-detail-row"><span>{t("meeting.meetingCode")}</span><strong>{snap.hideCode ? "••••••" : meetingCode ? formatMeetingCode(meetingCode) : "—"}</strong></div>
                <div className="meeting-detail-row"><span>{t("meeting.myRole")}</span><strong>{isHost ? t("meeting.roleHost") : t("meeting.roleParticipant")}</strong></div>
                {showJoinDuration && inMeeting && (
                  <div className="meeting-detail-row"><span>{t("meeting.joinDuration")}</span><strong>{formatDuration(joinElapsed * 1000)}</strong></div>
                )}
              </div>
            )}
          >
            <button type="button" className="meeting-title-btn" title={t("meeting.detailTitle")}>
              {meetingTitle}
            </button>
          </Popover>
          </ConfigProvider>
          <p className="meeting-header-meta">
            {meetingCode ? (
              <span className="meeting-code-row meeting-meta-code">
                <span className="meeting-code">
                  {t("meeting.meetingCode")}{snap.hideCode ? " ••••••" : ` ${formatMeetingCode(meetingCode)}`}
                </span>
                <button
                  type="button"
                  className="meeting-code-copy"
                  onClick={() => void handleCopyCode()}
                  aria-label={t("meeting.copyCode")}
                  title={copyHint ?? t("meeting.copyCode")}
                >
                  {copyHint ? (
                    <CheckOutlined style={{ fontSize: 16 }} aria-hidden />
                  ) : (
                    <CopyOutlined style={{ fontSize: 16 }} aria-hidden />
                  )}
                </button>
              </span>
            ) : (
              <span className="meeting-meta-code">{meetingId}</span>
            )}
            <span className="meeting-meta-name">
              <span>·</span>
              <span>{displayName}</span>
            </span>
            {recorder.recording && (
              <span className="recording-indicator" title={t("meeting.recording")}>
                <span className="recording-dot" aria-hidden />
                <span>{t("meeting.recording")} {formatDuration(recorder.recordElapsed)}</span>
              </span>
            )}
            {roleLabel ? (
              <span className="meeting-meta-role">
                <span>·</span>
                <span>{roleLabel}</span>
              </span>
            ) : null}
            {showJoinDuration && inMeeting && (
              <span className="meeting-meta-duration">
                <span>·</span>
                <span>{t("meeting.joinDuration")} {formatDuration(joinElapsed * 1000)}</span>
              </span>
            )}
          </p>
        </div>

        <div className="meeting-header-actions">
          {inMeeting && (
            <ConfigProvider theme={MEETING_DARK_OVERLAY_THEME}>
              <Popover
                trigger={["click"]}
                placement="bottomRight"
                content={(
              <div className="layout-panel">
                {layoutLocked && (
                  <p className="layout-panel-lock-hint">{t("meeting.layoutSwitchLockedHint")}</p>
                )}
                <div className="layout-panel-tabs">
                  <span className={`layout-tab-label${snap.layout === "grid" ? " is-active" : ""}`}>
                    {t("meeting.layoutGrid")}
                  </span>
                  <span className={`layout-tab-label layout-tab-label--grow${snap.layout === "speaker" ? " is-active" : ""}`}>
                    <span className="layout-tab-text">{t("meeting.layoutSpeaker")}</span>
                    <label className={`layout-panel-speakers${layoutLocked ? " is-locked" : ""}`}>
                      <input
                        type="checkbox"
                        checked={onlyShowSpeakers}
                        disabled={layoutLocked}
                        onChange={(e) => {
                          setOnlyShowSpeakers(e.target.checked);
                          localStorage.setItem("meeting.onlyShowSpeakers", e.target.checked ? "1" : "0");
                        }}
                      />
                      {t("meeting.onlyShowSpeakers")}
                    </label>
                  </span>
                </div>
                <div className="layout-panel-cards">
                  {/* 宫格卡片：两个点击区——缩略图区点击切宫格布局，等分标签区点击弹等分菜单 */}
                  <div className={`layout-card${snap.layout === "grid" ? " is-active" : ""}${layoutLocked ? " is-locked" : ""}`}>
                    <button
                      type="button"
                      className="layout-card-main"
                      title={t("meeting.layoutGrid")}
                      disabled={layoutLocked}
                      onClick={() => {
                        if (isHost && snap.layout !== "grid") roomRef.current?.setLayout("grid");
                      }}
                    >
                      <span className="layout-thumb layout-thumb--grid">
                        <i /><i /><i /><i /><i /><i /><i /><i /><i />
                      </span>
                    </button>
                    <Dropdown
                      trigger={["click"]}
                      placement="bottomLeft"
                      disabled={layoutLocked}
                      menu={{
                        items: GRID_DIVISIONS.map((n) => ({
                          key: String(n),
                          label: t("meeting.gridDivisions", { n }),
                        })),
                        selectedKeys: [String(layoutCols)],
                        onClick: ({ key }) => {
                          const n = Number(key) as LayoutCols;
                          setLayoutCols(n);
                          localStorage.setItem("meeting.layoutCols", key);
                          // 切换等分时联动切换会议布局（当前在演讲者布局则切回宫格）
                          if (isHost && snap.layout !== "grid") roomRef.current?.setLayout("grid");
                        },
                      }}
                    >
                      <button type="button" className="layout-card-label" disabled={layoutLocked}>
                        {t("meeting.gridDivisions", { n: layoutCols })}
                        <DownOutlined style={{ fontSize: 10 }} aria-hidden />
                      </button>
                    </Dropdown>
                  </div>
                  {([
                    ["embed", "layoutVariantEmbed", "layout-thumb--embed", 4],
                    ["top", "layoutVariantTop", "layout-thumb--top", 5],
                    ["float", "layoutVariantFloat", "layout-thumb--float", 3],
                  ] as const).map(([v, labelKey, thumbCls, iconCount]) => (
                    <button
                      key={v}
                      type="button"
                      className={`layout-card${snap.layout === "speaker" && sideListLayout === v ? " is-active" : ""}${layoutLocked ? " is-locked" : ""}`}
                      disabled={layoutLocked}
                      onClick={() => {
                        if (snap.layout !== "speaker" && isHost) roomRef.current?.setLayout("speaker");
                        // 房间级：host 总是可改；成员需"允许成员切换本地布局"开启（浮窗已禁用时点不到）
                        roomRef.current?.setSideListLayout(v);
                      }}
                    >
                      <span className={`layout-thumb ${thumbCls}`}>
                        {Array.from({ length: iconCount }, (_, i) => (
                          <i key={i} />
                        ))}
                      </span>
                      {t(`meeting.${labelKey}`)}
                    </button>
                  ))}
                </div>
              </div>
              )}
            >
              <button type="button" className="meeting-header-btn meeting-header-btn--ghost" aria-label={t("meeting.layoutLabel")}>
                <span className="meeting-header-btn-full">
                  {snap.layout === "grid" ? t("meeting.layoutGrid") : t("meeting.layoutSpeaker")}
                </span>
                <span className="meeting-header-btn-compact">{t("meeting.layoutLabel")}</span>
                <LayoutOutlined className="meeting-header-btn-icon" aria-hidden />
                <DownOutlined className="meeting-header-btn-caret" style={{ fontSize: 10, marginLeft: 6 }} aria-hidden />
              </button>
            </Popover>
            </ConfigProvider>
          )}
          {inMeeting && isHost && (
            <ConfigProvider theme={MEETING_DARK_OVERLAY_THEME}>
              <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                classNames={{ root: "meeting-dark-menu" }}
                menu={{
                  items: [
                    {
                      type: "group",
                      label: <span className="menu-group-title">{t("meeting.hostGroupMeeting")}</span>,
                      children: [
                        { key: "waiting", icon: hostMenuCheck(snap.waitingRoomEnabled), label: t("meeting.waitingRoomToggle") },
                        { key: "lock", icon: hostMenuCheck(snap.locked), label: t("meeting.toolLock") },
                        { key: "hideCode", icon: hostMenuCheck(snap.hideCode), label: t("meeting.toolHideCode") },
                        { key: "allMuted", icon: hostMenuCheck(snap.allMuted), label: t("meeting.toolAllMuted") },
                      ],
                    },
                    {
                      type: "group",
                      label: <span className="menu-group-title">{t("meeting.hostGroupPermission")}</span>,
                      children: [
                        { key: "freeChat", icon: hostMenuCheck(snap.chatAllowed), label: t("meeting.toolFreeChat") },
                        { key: "selfUnmute", icon: hostMenuCheck(snap.selfUnmuteAllowed), label: t("meeting.toolSelfUnmute") },
                        { key: "raiseHand", icon: hostMenuCheck(snap.raiseHandAllowed), label: t("meeting.toolRaiseHand") },
                        { key: "layoutSwitch", icon: hostMenuCheck(snap.layoutSwitchAllowed), label: t("meeting.toolLayoutSwitch") },
                      ],
                    },
                    {
                      type: "group",
                      label: <span className="menu-group-title">{t("meeting.hostGroupLayout")}</span>,
                      children: [
                        { key: "rotation", icon: hostMenuCheck(snap.rotationEnabled), label: t("meeting.rotationToggle") },
                        {
                          key: "rotationInterval",
                          icon: <span className="host-menu-check" />,
                          label: (
                            <span className="host-menu-label">
                              {t("meeting.rotationInterval")}
                              <span className="host-menu-value">
                                {snap.rotationIntervalMs / 1000}s
                              </span>
                            </span>
                          ),
                          children: ROTATION_INTERVALS.map((ms) => ({
                            key: String(ms),
                            icon: hostMenuCheck(snap.rotationIntervalMs === ms),
                            label: `${ms / 1000}s`,
                          })),
                        },
                        { key: "sideList", icon: hostMenuCheck(snap.sideListVisible), label: t("meeting.sideListVisible") },
                        { key: "danmu", icon: hostMenuCheck(snap.danmuEnabled), label: t("meeting.toolDanmu") },
                      ],
                    },
                  ],
                  onClick: ({ key }) => {
                    const room = roomRef.current;
                    if (!room) return;
                    // 轮播间隔子菜单叶子节点：key 为毫秒数值
                    if (/^\d+$/.test(key)) {
                      room.setRotationInterval(Number(key));
                      return;
                    }
                    switch (key) {
                      case "lock": room.setLocked(!snap.locked); break;
                      case "hideCode": room.setHideCode(!snap.hideCode); break;
                      case "freeChat": room.setChatAllowed(!snap.chatAllowed); break;
                      case "selfUnmute": room.setSelfUnmuteAllowed(!snap.selfUnmuteAllowed); break;
                      case "raiseHand": room.setRaiseHandAllowed(!snap.raiseHandAllowed); break;
                      case "rotation": room.setRotation(!snap.rotationEnabled); break;
                      case "allMuted": room.setAllMuted(!snap.allMuted); break;
                      case "sideList": room.setSideListVisible(!snap.sideListVisible); break;
                      case "layoutSwitch": room.setLayoutSwitchAllowed(!snap.layoutSwitchAllowed); break;
                      case "danmu": room.setDanmuEnabled(!snap.danmuEnabled); break;
                      case "waiting": room.setWaitingRoom(!snap.waitingRoomEnabled); break;
                    }
                  },
                }}
              >
                <button type="button" className="meeting-header-btn meeting-header-btn--ghost" title={t("meeting.hostTools")}>
                  <span className="meeting-header-btn-full">{t("meeting.hostTools")}</span>
                  <span className="meeting-header-btn-compact">{t("meeting.hostToolsShort")}</span>
                  <ToolOutlined className="meeting-header-btn-icon" aria-hidden />
                  <DownOutlined className="meeting-header-btn-caret" style={{ fontSize: 10, marginLeft: 6 }} aria-hidden />
                </button>
              </Dropdown>
            </ConfigProvider>
          )}


          <div className="meeting-settings" ref={settingsRef}>
            <button
              type="button"
              className={`meeting-header-btn meeting-header-btn--icon${settingsOpen ? " is-active" : ""}`}
              style={{ background: "transparent", border: 0 }}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              aria-label={t("meeting.settings")}
            >
              <SettingOutlined style={{ fontSize: 20 }} />
            </button>
            <button
              type="button"
              className="meeting-header-btn meeting-header-btn--icon"
              style={{ background: "transparent", border: 0 }}
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? t("meeting.exitFullscreen") : t("meeting.fullscreen")}
              title={isFullscreen ? t("meeting.exitFullscreen") : t("meeting.fullscreen")}
            >
              {isFullscreen ? (
                <FullscreenExitOutlined style={{ fontSize: 20 }} />
              ) : (
                <FullscreenOutlined style={{ fontSize: 20 }} />
              )}
            </button>
            {settingsOpen && (
              <div className="meeting-settings-popover" role="dialog">
                <h3 className="meeting-settings-title">{t("meeting.settings")}</h3>
                {/* 设备选择已迁至底部"静音/摄像头"按钮菜单；此处仅保留纯个人显示偏好 */}
                <label className="checkbox danmu-toggle-row">
                  {t("meeting.showActiveSpeaker")}
                  <input
                    type="checkbox"
                    checked={showActiveSpeaker}
                    onChange={(e) => {
                      setShowActiveSpeaker(e.target.checked);
                      localStorage.setItem("meeting.showActiveSpeaker", e.target.checked ? "1" : "0");
                    }}
                  />
                </label>
                <label className="checkbox danmu-toggle-row">
                  {t("meeting.showJoinDuration")}
                  <input
                    type="checkbox"
                    checked={showJoinDuration}
                    onChange={(e) => {
                      setShowJoinDuration(e.target.checked);
                      localStorage.setItem("meeting.showJoinDuration", e.target.checked ? "1" : "0");
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </header>

        {/* 阻断级错误（红）：进不了会 / 人数超限等。
            锁定 / 人数超限为"无法进入"类错误：渲染带"返回首页"按钮的面板，避免用户卡在本页 */}
        {snap.error === "meeting_locked" || snap.error === "online_limit_reached" ? (
          <section className="panel meeting-ended">
            <h2>
              {snap.error === "meeting_locked"
                ? t("meeting.meetingLockedHint")
                : t("meeting.onlineLimitReached")}
            </h2>
            <button type="button" onClick={() => goHome()}>
              {t("meeting.backHome")}
            </button>
          </section>
        ) : snap.error && snap.error !== "reconnect_failed" ? (
          <p className="error">{snap.error}</p>
        ) : null}

        {/* 非阻断警示（黄）：媒体消费失败 / 权限受限等，10 秒自动消散，不影响会议继续使用 */}
        {inMeeting && snap.warning && warningDismissed !== snap.warning && (
          <p className="warning">
            {snap.warning === "insecure_context"
              ? t("meeting.insecureContext")
              : snap.warning === "share_not_allowed"
              ? t("meeting.shareNotAllowed")
              : snap.warning === "screen_share_failed"
              ? t("meeting.screenShareFailed")
              : snap.warning === "screenShareAudioActive"
              ? t("meeting.screenShareAudioActive")
              : snap.warning === "audioDeviceLost"
              ? t("meeting.audioDeviceLost")
              : snap.warning === "videoDeviceLost"
              ? t("meeting.videoDeviceLost")
              : snap.warning.startsWith("consume_failed:")
              ? `${t("meeting.consumeFailed")}（${snap.warning.slice("consume_failed:".length)}）`
              : snap.warning}
          </p>
        )}

        {snap.status === "kicked" && (
          <section className="panel meeting-ended">
            <h2>{t("meeting.kicked")}</h2>
            {snap.endedReason ? (
              <p className="muted">{snap.endedReason}</p>
            ) : null}
            <button type="button" onClick={() => goHome()}>
              {t("meeting.backHome")}
            </button>
          </section>
        )}

        {snap.status === "error" && snap.error === "reconnect_failed" && (
          <section className="panel meeting-ended">
            <h2>{t("meeting.reconnectFailed")}</h2>
            <button type="button" onClick={() => goHome()}>
              {t("meeting.backHome")}
            </button>
          </section>
        )}

        {snap.status === "connecting" && (
          <div className="meeting-connecting-wrap">
            <p className="muted meeting-connecting">{t("meeting.connecting")}</p>
            <button
              type="button"
              className={`btn-invite-toggle ${inviteListOpen ? "is-active" : ""}`}
              onClick={() => setInviteListOpen((v) => !v)}
            >
              {t("meeting.inviteList", "名单")}
            </button>
          </div>
        )}

        {snap.status === "reconnecting" && (
          <div className="meeting-connecting-wrap">
            <p className="muted meeting-connecting">
              {t("meeting.reconnecting")}
            </p>
          </div>
        )}

        {selfWaiting && !inMeeting && (
          <div className="meeting-waiting-wrap">
            <button
              type="button"
              className={`btn-invite-toggle ${inviteListOpen ? "is-active" : ""}`}
              onClick={() => setInviteListOpen((v) => !v)}
            >
              {t("meeting.inviteList", "名单")}
            </button>
          </div>
        )}

        {/* 邀请名单面板：在 connecting/waiting 状态下独立浮出 */}
        {!inMeeting && inviteListOpen && meetingId && (
          <InvitationPanel
            invitations={invitations}
            peers={[]}
            floating
            onClose={() => setInviteListOpen(false)}
          />
        )}

        <WaitingRoom
          selfWaiting={selfWaiting}
          isHost={isHost}
          waitingPeers={snap.waitingPeers}
          onAdmit={(id) => roomRef.current?.admit(id)}
          onDeny={(id) => roomRef.current?.deny(id)}
        />

        {inMeeting && (
          <div className="meeting-main">
            <div className="meeting-videos">
              <VideoGrid
                localStream={snap.localStream}
                localScreenStream={snap.localScreenStream}
                localLabel={displayName}
                localPeerId={snap.peerId}
                localCamEnabled={snap.camEnabled}
                localMicEnabled={snap.micEnabled}
                selfHandRaised={snap.handRaised}
                remoteStreams={snap.remoteStreams}
                screenStreams={snap.screenStreams}
                screenAudioStreams={snap.screenAudioStreams}
                screenAudioMuted={screenAudioMuted}
                peers={snap.peers}
                layout={snap.layout}
                focusPeerId={snap.focusPeerId}
                layoutCols={layoutCols}
                sideListVisible={isHost || snap.sideListVisible}
                sideVariant={sideListLayout}
                onlySpeakers={onlyShowSpeakers ? activeSpeakers : null}
                hostPeerId={
                  isHost
                    ? snap.peerId
                    : snap.peers.find((p) => p.role === "host")?.peerId ?? null
                }
                onFocusPeer={
                  // 需求 5：仅发起者/主持人可切换发言者画面（null = 退出焦点）
                  isHost
                    ? (peerId) => {
                        roomRef.current?.setFocus(peerId);
                      }
                    : undefined
                }
                peerRtt={snap.peerRtt}
                rotationEnabled={snap.rotationEnabled}
                rotationIntervalMs={snap.rotationIntervalMs}
              />
              {snap.danmuEnabled && (
                <DanmuOverlay
                  items={danmuItems}
                  onExpired={(id) =>
                    setDanmuItems((prev) => prev.filter((d) => d.id !== id))
                  }
                />
              )}
            </div>

            {showMembersPanel && (
              <FloatingPanel
                dockedRight={slotFor("members")}
                onDetach={() => detachPanel("members")}
                className="floating-panel--members"
              >
                <HostControls
                  isHost={isHost}
                  allMuted={allMuted}
                  peers={[
                    // 服务端 peers 刻意不含自己；成员列表需展示全部入会人员
                    //（含主持人/自己），此处把本端条目补到最前
                    ...(snap.peerId
                      ? [
                          {
                            peerId: snap.peerId,
                            displayName,
                            role: snap.role ?? "participant",
                            handRaised: snap.handRaised,
                            micEnabled: snap.micEnabled,
                            camEnabled: snap.camEnabled,
                            recording: false,
                          },
                        ]
                      : []),
                    ...snap.peers,
                  ]}
                  selfPeerId={snap.peerId}
                  invitations={invitations}
                  onClose={() => closePanel("members")}
                  onToggleMuteAll={() => {
                    if (allMuted) {
                      roomRef.current?.unmuteAll();
                      setAllMuted(false);
                    } else {
                      roomRef.current?.muteAll();
                      setAllMuted(true);
                    }
                  }}
                  onMutePeer={(peerId) => {
                    roomRef.current?.mutePeer(peerId);
                  }}
                  onUnmutePeer={(peerId) => {
                    roomRef.current?.unmutePeer(peerId);
                  }}
                  onKick={(peerId) => {
                    roomRef.current?.kickPeer(peerId);
                  }}
                />
              </FloatingPanel>
            )}
            {showChatPanel && (
              <FloatingPanel
                dockedRight={slotFor("chat")}
                onDetach={() => detachPanel("chat")}
                className="floating-panel--chat"
              >
                <ChatPanel
                  messages={snap.chatMessages}
                  selfPeerId={snap.peerId}
                  onSend={(text) => roomRef.current?.sendChat(text)}
                  onClose={() => closePanel("chat")}
                />
              </FloatingPanel>
            )}
          </div>
        )}

        {/* 本地媒体降级提示（非阻断）：无摄像头/无麦克风/权限拒绝时仍可观看他人。
            浮条置于画面区顶部居中，不挤压视频布局 */}
        {inMeeting && snap.localMediaError && (
          <div className="meeting-media-hint" role="status">
            <WarningOutlined aria-hidden />
            <span>
              {snap.localMediaError === "no_camera"
                ? t("meeting.noCameraHint")
                : snap.localMediaError === "no_media_devices"
                  ? t("meeting.noMediaHint")
                  : snap.localMediaError === "media_permission_denied"
                    ? t("meeting.mediaPermissionHint")
                    : t("meeting.mediaCaptureHint")}
            </span>
          </div>
        )}
      </div>

      {inMeeting && (
        <Controls
          micEnabled={snap.micEnabled}
          camEnabled={snap.camEnabled}
          handRaised={snap.handRaised}
          handDisabled={!snap.raiseHandAllowed && !isHost}
          sharingScreen={snap.sharingScreen}
          canShare={snap.canShare}
          isHost={isHost}
          membersOpen={membersOpen}
          chatOpen={chatOpen}
          unreadChat={unreadChat}
          onToggleMic={() => {

            if (!snap.micEnabled && !isHost && (snap.allMuted || !snap.selfUnmuteAllowed)) {

              showMessage(snap.allMuted ? t("meeting.allMutedHint") : t("meeting.selfUnmuteDisabled"));

              return;

            }

            void roomRef.current

                      ?.setMicEnabled(!snap.micEnabled)

                      .catch((err) => console.warn("[rtc] toggle mic failed:", err));
          }}
          onToggleCam={() => {
            void roomRef.current
                      ?.setCamEnabled(!snap.camEnabled)
                      .catch((err) => console.warn("[rtc] toggle cam failed:", err));
          }}
          onToggleHand={() => {
            roomRef.current?.setHandRaised(!snap.handRaised);
          }}
          onToggleScreenShare={() => {
            if (snap.sharingScreen) {
              void roomRef.current
                      ?.stopScreenShare()
                      .catch((err) => console.warn("[rtc] stop screen share failed:", err));
            } else {
              void roomRef.current
                      ?.startScreenShare()
                      .catch((err) => console.warn("[rtc] start screen share failed:", err));
            }
          }}
          onToggleMembers={() => {
            toggleMembers();
          }}
          onToggleChat={() => {
            toggleChat();
          }}
          onInvite={() => setInviteOpen(true)}
          onLeave={() => {
            roomRef.current?.leave();
            goHome();
          }}
          onEndMeeting={() => {
            roomRef.current?.endMeeting();
          }}
          recording={recorder.recording}
          canRecord={canRecord}
          onToggleRecord={handleToggleRecord}
          allowShare={snap.allowShare}
          recordAllowed={snap.recordAllowed}
          micBanned={!isHost && (snap.allMuted || !snap.selfUnmuteAllowed)}
          micBannedTip={
            snap.allMuted
              ? t("meeting.allMutedHint")
              : t("meeting.selfUnmuteDisabled")
          }
          onToggleAllowShare={() => {
            roomRef.current?.setSharePermission(!snap.allowShare);
          }}
          onToggleRecordAllowed={() => {
            roomRef.current?.setRecordAllowed(!snap.recordAllowed);
          }}
          audioInputs={audioInputs}
          videoInputs={videoInputs}
          audioId={audioId}
          videoId={videoId}
          onChangeAudio={(id) => {
            setAudioId(id);
            void roomRef.current?.switchDevice("audio", id).catch((err) => {
              console.warn("[rtc] switch audio device failed:", err);
            });
          }}
          onChangeVideo={(id) => {
            setVideoId(id);
            void roomRef.current?.switchDevice("video", id).catch((err) => {
              console.warn("[rtc] switch video device failed:", err);
            });
          }}
          screenAudioAvailable={snap.screenAudioStreams.size > 0}
          screenAudioMuted={screenAudioMuted}
          onToggleScreenAudio={() => setScreenAudioMuted((m) => !m)}
        />
      )}

      <Modal
        open={inviteOpen}
        title={t("meeting.inviteTitle")}
        tone="dark"
        onClose={() => {
          setInviteOpen(false);
          setCopyHint(null);
        }}
        footer={
          <div className="modal-footer-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={!meetingCode}
              onClick={() => void handleCopyCode()}
            >
              {copyHint ?? t("meeting.copyCode")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={!meetingCode}
              onClick={() => void handleCopyLink()}
            >
              {copyHint ?? t("meeting.copyLink")}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!meetingCode}
              onClick={() => void handleCopyAll()}
            >
              {copyHint ?? t("meeting.copyAll")}
            </button>
          </div>
        }
      >
        <div className="form">
          <label>
            {t("meeting.meetingCode")}
            <div className="meeting-code-row" style={{ marginTop: "0.35rem" }}>
              <span className="meeting-code" style={{ color: "inherit" }}>
                {meetingCode ? formatMeetingCode(meetingCode) : "—"}
              </span>
            </div>
          </label>
          <label>
            {t("meeting.inviteLink")}
            <input readOnly value={inviteLink} />
          </label>
          <p className="muted">{t("meeting.inviteLinkHint")}</p>
        </div>
      </Modal>
    </main>
  );
}

export function MeetingPage() {
  return (
    <AntApp>
      <MeetingPageInner />
    </AntApp>
  );
}
