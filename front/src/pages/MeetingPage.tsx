import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CopyOutlined,
  CheckOutlined,
  SettingOutlined,
  DownOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
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
import { useRecorder } from "@/hooks/useRecorder";
import { SignalClient } from "@/signal/client";
import { showMessage } from "@/ui/toast";
import type { RecorderSource } from "@/media/recorder";
import { App as AntApp, Dropdown, Popover } from "antd";

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
  // 成员画面轮换间隔（本地设置，持久化；主持人开关状态走信令）
  const [rotationIntervalMs, setRotationIntervalMs] = useState<number>(() => {
    const raw = Number(localStorage.getItem("rotationIntervalMs"));
    return raw === 5000 || raw === 15000 || raw === 30000 ? raw : 15000;
  });
  useEffect(() => {
    localStorage.setItem("rotationIntervalMs", String(rotationIntervalMs));
  }, [rotationIntervalMs]);
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
  useEffect(() => {
    if (!snap.warning) {
      setWarningDismissed(null);
      return;
    }
    setWarningDismissed(null);
    const timer = setTimeout(() => setWarningDismissed(snap.warning), 10_000);
    return () => clearTimeout(timer);
  }, [snap.warning]);
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
  const [sideListLayout, setSideListLayout] = useState<"embed" | "top" | "float">(function (init) { return init === "top" || init === "float" ? init : "embed"; }(localStorage.getItem("meeting.sideListLayout") || "default"));
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
  const [danmuEnabled, setDanmuEnabled] = useState(false);
  const [layoutCols, setLayoutCols] = useState<LayoutCols>("auto");
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

    if (danmuEnabled) {
      const items = newMsgs.map((m) => ({
        id: ++danmuIdRef.current,
        text: `${m.displayName}: ${m.text}`,
        self: snap.peerId != null && m.peerId === snap.peerId,
      }));
      setDanmuItems((prevItems) => [...prevItems, ...items].slice(-30));
    }
  }, [snap.chatMessages, chatOpen, danmuEnabled, snap.peerId]);

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

    void roomRef.current?.startScreenShare().catch((err) => {
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
  const inMeeting = snap.status === "joined";
  const isHost = snap.role === "host";
  // 主持人始终可录制；普通参会者需主持人开启"开启录制"
  const canRecord = isHost || snap.recordAllowed;

  // 参会时长计时

  const [joinElapsed, setJoinElapsed] = useState(0);

  useEffect(() => {

    if (!inMeeting) { setJoinElapsed(0); return; }

    const startedAt = Date.now();

    const timer = window.setInterval(() => setJoinElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);

    return () => window.clearInterval(timer);

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
    <main className="meeting-page">
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
          <Popover
            placement="bottomLeft"
            content={(
              <div className="meeting-detail-panel">
                <div className="meeting-detail-row"><span>{t("meeting.detailTitle")}</span><strong>{meetingTitle}</strong></div>
                <div className="meeting-detail-row"><span>{t("meeting.meetingCode")}</span><strong>{snap.hideCode ? "••••••" : meetingCode ? formatMeetingCode(meetingCode) : "—"}</strong></div>
                <div className="meeting-detail-row"><span>{t("meeting.myRole")}</span><strong>{isHost ? t("meeting.roleHost") : t("meeting.roleParticipant")}</strong></div>
                {showJoinDuration && inMeeting && (
                  <div className="meeting-detail-row"><span>{t("meeting.joinDuration")}</span><strong>{formatDuration(joinElapsed)}</strong></div>
                )}
              </div>
            )}
          >
            <button type="button" className="meeting-title-btn" title={t("meeting.detailTitle")}>
              {meetingTitle}
            </button>
          </Popover>
          <p className="meeting-header-meta">
            {meetingCode ? (
              <span className="meeting-code-row">
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
              <span>{meetingId}</span>
            )}
            <span>·</span>
            <span>{displayName}</span>
            {recorder.recording && (
              <span className="recording-indicator" title={t("meeting.recording")}>
                <span className="recording-dot" aria-hidden />
                <span>{t("meeting.recording")} {formatDuration(recorder.recordElapsed)}</span>
              </span>
            )}
            {roleLabel ? (
              <>
                <span>·</span>
                <span>{roleLabel}</span>
              </>
            ) : null}
            {showJoinDuration && inMeeting && (
              <>
                <span>·</span>
                <span>{t("meeting.joinDuration")} {formatDuration(joinElapsed)}</span>
              </>
            )}
          </p>
        </div>

        <div className="meeting-header-actions">
          {inMeeting && (
            <Popover
              trigger={["click"]}
              placement="bottomRight"
              content={(
              <div className="layout-panel">
                <div className="layout-panel-head">
                  <span className="layout-panel-title">{t("meeting.layoutPanelTitle")}</span>
                  <label className="layout-panel-speakers">
                    <input
                      type="checkbox"
                      checked={onlyShowSpeakers}
                      onChange={(e) => {
                        setOnlyShowSpeakers(e.target.checked);
                        localStorage.setItem("meeting.onlyShowSpeakers", e.target.checked ? "1" : "0");
                      }}
                    />
                    {t("meeting.onlyShowSpeakers")}
                  </label>
                </div>
                <div className="layout-panel-tabs">
                  <button
                    type="button"
                    className={snap.layout === "grid" ? "is-active" : ""}
                    disabled={!isHost}
                    title={isHost ? undefined : t("meeting.hostOnlyHint")}
                    onClick={() => {
                      if (isHost && snap.layout !== "grid") roomRef.current?.setLayout("grid");
                    }}
                  >
                    {t("meeting.layoutGrid")}
                  </button>
                  <button
                    type="button"
                    className={snap.layout === "speaker" ? "is-active" : ""}
                    disabled={!isHost}
                    title={isHost ? undefined : t("meeting.hostOnlyHint")}
                    onClick={() => {
                      if (isHost && snap.layout !== "speaker") roomRef.current?.setLayout("speaker");
                    }}
                  >
                    {t("meeting.layoutSpeaker")}
                  </button>
                </div>
                {snap.layout === "grid" ? (
                  <div className="layout-panel-cards">
                    <button type="button" className="layout-card is-active">
                      <span className="layout-thumb layout-thumb--grid">
                        <i /><i /><i /><i /><i /><i /><i /><i /><i />
                      </span>
                      {t("meeting.layoutGridNine")}
                    </button>
                  </div>
                ) : (
                  <div className="layout-panel-cards">
                    {([
                      ["embed", "layoutVariantEmbed", "layout-thumb--embed"],
                      ["top", "layoutVariantTop", "layout-thumb--top"],
                      ["float", "layoutVariantFloat", "layout-thumb--float"],
                    ] as const).map(([v, labelKey, thumbCls]) => (
                      <button
                        key={v}
                        type="button"
                        className={`layout-card${sideListLayout === v ? " is-active" : ""}`}
                        onClick={() => {
                          if (snap.layout !== "speaker" && isHost) roomRef.current?.setLayout("speaker");
                          setSideListLayout(v);
                          localStorage.setItem("meeting.sideListLayout", v);
                        }}
                      >
                        <span className={`layout-thumb ${thumbCls}`}>
                          <i /><i />
                        </span>
                        {t(`meeting.${labelKey}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}
            >
              <button type="button" className="meeting-header-btn" aria-label={t("meeting.layoutLabel")}>
                {snap.layout === "grid" ? t("meeting.layoutGrid") : t("meeting.layoutSpeaker")}
                <DownOutlined style={{ fontSize: 10, marginLeft: 6 }} aria-hidden />
              </button>
            </Popover>
          )}
          {inMeeting && isHost && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  { key: "lock", label: (snap.locked ? "\u2713 " : "") + t("meeting.toolLock") },
                  { key: "hideCode", label: (snap.hideCode ? "\u2713 " : "") + t("meeting.toolHideCode") },
                  { key: "freeChat", label: (snap.chatAllowed ? "\u2713 " : "") + t("meeting.toolFreeChat") },
                  { key: "selfUnmute", label: (snap.selfUnmuteAllowed ? "\u2713 " : "") + t("meeting.toolSelfUnmute") },
                  { key: "raiseHand", label: (snap.raiseHandAllowed ? "\u2713 " : "") + t("meeting.toolRaiseHand") },
                  { key: "reaction", label: (snap.reactionAllowed ? "\u2713 " : "") + t("meeting.toolReaction") },
                  { type: "divider" },
                  { key: "waiting", label: (snap.waitingRoomEnabled ? "\u2713 " : "") + t("meeting.waitingRoomToggle") },
                  { key: "record", label: (snap.recordAllowed ? "\u2713 " : "") + t("meeting.recordToggle") },
                ],
                onClick: ({ key }) => {
                  switch (key) {
                    case "lock": roomRef.current?.setLocked(!snap.locked); break;
                    case "hideCode": roomRef.current?.setHideCode(!snap.hideCode); break;
                    case "freeChat": roomRef.current?.setChatAllowed(!snap.chatAllowed); break;
                    case "selfUnmute": roomRef.current?.setSelfUnmuteAllowed(!snap.selfUnmuteAllowed); break;
                    case "raiseHand": roomRef.current?.setRaiseHandAllowed(!snap.raiseHandAllowed); break;
                    case "reaction": roomRef.current?.setReactionAllowed(!snap.reactionAllowed); break;
                    case "waiting": roomRef.current?.setWaitingRoom(!snap.waitingRoomEnabled); break;
                    case "record": roomRef.current?.setRecordAllowed(!snap.recordAllowed); break;
                  }
                },
              }}
            >
              <button type="button" className="meeting-header-btn" title={t("meeting.hostTools")}>
                {t("meeting.hostTools")}
                <DownOutlined style={{ fontSize: 10, marginLeft: 6 }} aria-hidden />
              </button>
            </Dropdown>
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
                <label className="control-select">
                  {t("meeting.mic")}
                  <select
                    value={audioId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setAudioId(id);
                      void roomRef.current?.switchDevice("audio", id).catch((err) => {
                        console.warn("[rtc] switch audio device failed:", err);
                      });
                    }}
                  >
                    {audioInputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label ||
                          t("meeting.deviceMicFallback", {
                            id: d.deviceId.slice(0, 6),
                          })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="control-select">
                  {t("meeting.camera")}
                  <select
                    value={videoId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setVideoId(id);
                      void roomRef.current?.switchDevice("video", id).catch((err) => {
                        console.warn("[rtc] switch video device failed:", err);
                      });
                    }}
                  >
                    {videoInputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label ||
                          t("meeting.deviceCamFallback", {
                            id: d.deviceId.slice(0, 6),
                          })}
                      </option>
                    ))}
                  </select>
                </label>
                {isHost && (
                  <label className="control-check">
                    <input
                      type="checkbox"
                      checked={snap.rotationEnabled}
                      onChange={(e) => {
                        roomRef.current?.setRotation(e.target.checked);
                      }}
                    />
                    {t("meeting.rotationToggle")}
                  </label>
                )}
                <label className="control-select">
                  {t("meeting.rotationInterval")}
                  <select
                    value={rotationIntervalMs}
                    onChange={(e) => setRotationIntervalMs(Number(e.target.value))}
                  >
                    <option value={5000}>5s</option>
                    <option value={15000}>15s</option>
                    <option value={30000}>30s</option>
                  </select>
                  </label>
                {isHost && (
                  <label className="checkbox danmu-toggle-row">
                    <input
                      type="checkbox"
                      checked={snap.sideListVisible}
                      onChange={(e) => roomRef.current?.setSideListVisible(e.target.checked)}
                    />
                    {t("meeting.sideListVisible")}
                  </label>
                )}
                <label className="control-select">
                  {t("meeting.sideListLayout")}
                  <select
                    value={sideListLayout}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSideListLayout(v === "top" ? "top" : v === "float" ? "float" : "embed");
                      localStorage.setItem("meeting.sideListLayout", v);
                    }}
                  >
                    <option value="embed">{t("meeting.sideListDefault")}</option>
                    <option value="top">{t("meeting.sideListTop")}</option>
                    <option value="float">{t("meeting.sideListFloat")}</option>
                  </select>
                </label>
                <label className="checkbox danmu-toggle-row">
                  <input
                    type="checkbox"
                    checked={onlyShowSpeakers}
                    onChange={(e) => {
                      setOnlyShowSpeakers(e.target.checked);
                      localStorage.setItem("meeting.onlyShowSpeakers", e.target.checked ? "1" : "0");
                    }}
                  />
                  {t("meeting.onlyShowSpeakers")}
                </label>
                <label className="control-select">
                  {t("meeting.layoutCols")}
                  <select
                    value={String(layoutCols)}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLayoutCols(v === "4" ? 4 : v === "6" ? 6 : "auto");
                    }}
                  >
                    <option value="auto">{t("meeting.layoutColsAuto")}</option>
                    <option value="4">{t("meeting.layoutCols4")}</option>
                    <option value="6">{t("meeting.layoutCols6")}</option>
                  </select>
                </label>
                <label className="checkbox danmu-toggle-row">
                  <input
                    type="checkbox"
                    checked={danmuEnabled}
                    onChange={(e) => {
                      const v = e.target.checked;
                      setDanmuEnabled(v);
                      if (!v) setDanmuItems([]);
                    }}
                  />
                  {t("meeting.danmuToggle")}
                </label>
                <label className="checkbox danmu-toggle-row">
                  <input
                    type="checkbox"
                    checked={showActiveSpeaker}
                    onChange={(e) => {
                      setShowActiveSpeaker(e.target.checked);
                      localStorage.setItem("meeting.showActiveSpeaker", e.target.checked ? "1" : "0");
                    }}
                  />
                  {t("meeting.showActiveSpeaker")}
                </label>
                <label className="checkbox danmu-toggle-row">
                  <input
                    type="checkbox"
                    checked={showJoinDuration}
                    onChange={(e) => {
                      setShowJoinDuration(e.target.checked);
                      localStorage.setItem("meeting.showJoinDuration", e.target.checked ? "1" : "0");
                    }}
                  />
                  {t("meeting.showJoinDuration")}
                </label>
                {isHost && (
                  <label className="checkbox danmu-toggle-row">
                    <input
                      type="checkbox"
                      checked={snap.waitingRoomEnabled}
                      onChange={(e) => {
                        roomRef.current?.setWaitingRoom(e.target.checked);
                      }}
                    />
                    {t("meeting.waitingRoomToggle")}
                  </label>
                )}
                {isHost && (
                  <label className="checkbox danmu-toggle-row">
                    <input
                      type="checkbox"
                      checked={snap.recordAllowed}
                      onChange={(e) => {
                        roomRef.current?.setRecordAllowed(e.target.checked);
                      }}
                    />
                    {t("meeting.recordAllowedToggle")}
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

        {/* 阻断级错误（红）：进不了会 / 人数超限等 */}
        {snap.error && snap.error !== "reconnect_failed" && (
          <p className="error">
            {snap.error === "meeting_locked"
              ? t("meeting.meetingLockedHint")
              : snap.error === "online_limit_reached"
              ? t("meeting.onlineLimitReached")
              : snap.error}
          </p>
        )}

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

        {/* 本地媒体降级提示（非阻断）：无摄像头/无麦克风/权限拒绝时仍可观看他人 */}
        {inMeeting && snap.localMediaError && (
          <p className="muted meeting-media-hint">
            {snap.localMediaError === "no_camera"
              ? t("meeting.noCameraHint")
              : snap.localMediaError === "no_media_devices"
                ? t("meeting.noMediaHint")
                : snap.localMediaError === "media_permission_denied"
                  ? t("meeting.mediaPermissionHint")
                  : t("meeting.mediaCaptureHint")}
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
                rotationIntervalMs={rotationIntervalMs}
              />
              {danmuEnabled && (
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
                  allowShare={snap.allowShare}
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
                  onToggleAllowShare={() => {
                    roomRef.current?.setSharePermission(!snap.allowShare);
                  }}
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
      </div>

      {inMeeting && (
        <Controls
          micEnabled={snap.micEnabled}
          camEnabled={snap.camEnabled}
          handRaised={snap.handRaised}
          handDisabled={!snap.raiseHandAllowed && !isHost}
          onReaction={(emoji) => roomRef.current?.setReaction(emoji)}
          reactionDisabled={!snap.reactionAllowed && !isHost}
          sharingScreen={snap.sharingScreen}
          canShare={snap.canShare}
          isHost={isHost}
          membersOpen={membersOpen}
          chatOpen={chatOpen}
          unreadChat={unreadChat}
          onToggleMic={() => {

            if (!snap.micEnabled && !snap.selfUnmuteAllowed && !isHost) {

              showMessage(t("meeting.selfUnmuteDisabled"));

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
