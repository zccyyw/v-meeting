import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { CopyOutlined, CheckOutlined, SettingOutlined } from "@ant-design/icons";
import { MeetingApi, RecordingsApi, InvitationApi, type InvitationItem } from "@/api/client";
import { copyText, formatMeetingCode } from "@/auth/joinPrefs";
import { Controls } from "@/components/Controls";
import { ChatPanel } from "@/components/ChatPanel";
import { DanmuOverlay } from "@/components/DanmuOverlay";
import { HostControls } from "@/components/HostControls";
import { Modal } from "@/components/Modal";
import { VideoGrid, type LayoutCols } from "@/components/VideoGrid";
import { WaitingRoom } from "@/components/WaitingRoom";
import { InvitationPanel } from "@/components/InvitationPanel";
import { MediaRoom, type MediaRoomSnapshot } from "@/media/room";
import { SignalClient } from "@/signal/client";
import { showMessage } from "@/ui/toast";
import { startRecording, type RecorderHandle, type RecorderSource } from "@/media/recorder";
import { App as AntApp } from "antd";

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
  micEnabled: true,
  camEnabled: false,
  handRaised: false,
  layout: "grid",
  focusPeerId: null,
  sharingScreen: false,
  canShare: true,
  allowShare: true,
  waitingRoomEnabled: false,
  recordAllowed: false,
  chatMessages: [],
  error: null,
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
  const [membersOpen, setMembersOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteListOpen, setInviteListOpen] = useState(false);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [allMuted, setAllMuted] = useState(false);
  const [unreadChat, setUnreadChat] = useState(0);
  const [danmuEnabled, setDanmuEnabled] = useState(false);
  const [layoutCols, setLayoutCols] = useState<LayoutCols>("auto");
  const [danmuItems, setDanmuItems] = useState<
    { id: number; text: string; self: boolean }[]
  >([]);
  const danmuIdRef = useRef(0);
  const lastChatLenRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const recorderHandleRef = useRef<RecorderHandle | null>(null);
  const recordStartRef = useRef<number>(0);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const lastRecordingPeersRef = useRef<Set<string>>(new Set());
  const [meetingCode, setMeetingCode] = useState(
    () => params.get("code")?.replace(/\D/g, "") ?? "",
  );
  const [meetingTitle, setMeetingTitle] = useState(() => t("meeting.title"));
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioId, setAudioId] = useState("");
  const [videoId, setVideoId] = useState("");
  const roomRef = useRef<MediaRoom | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const autoShareTried = useRef(false);

  const wantAutoShare = params.get("share") === "1";

  // 录制时长计时
  useEffect(() => {
    if (!recording) {
      setRecordElapsed(0);
      return;
    }
    const t = window.setInterval(() => {
      setRecordElapsed(Date.now() - recordStartRef.current);
    }, 1000);
    return () => window.clearInterval(t);
  }, [recording]);

  // 监听他人录制状态变化 -> Toast + 聊天系统消息
  useEffect(() => {
    const prev = lastRecordingPeersRef.current;
    const current = new Set(
      snap.peers.filter((p) => p.recording && p.peerId !== snap.peerId).map((p) => p.peerId),
    );
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
    navigate("/", { replace: true });
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
      if (recorderHandleRef.current) {
        try {
          void recorderHandleRef.current.stop();
        } catch {
          /* ignore */
        }
        recorderHandleRef.current = null;
        setRecording(false);
      }
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
        setAudioId((prev) => prev || audios[0]?.deviceId || "");
        setVideoId((prev) => prev || videos[0]?.deviceId || "");
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
  useEffect(() => {
    if ((!membersOpen && !inviteListOpen) || !meetingId) return;
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
  }, [membersOpen, inviteListOpen, meetingId, snap.peers.length]);

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
    if (recording) {
      // 停止并上传
      const handle = recorderHandleRef.current;
      if (!handle) return;
      setRecording(false);
      const durationMs = handle.durationMs();
      roomRef.current?.notifyRecordingStopped();
      void handle.stop().then(async (blob) => {
        recorderHandleRef.current = null;
        showMessage(t("meeting.recordingSaving"));
        try {
          await RecordingsApi.upload(blob, {
            title: `${meetingTitle}-${new Date().toLocaleString()}`,
            meetingId: meetingId ? Number(meetingId) : null,
            durationMs,
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
    try {
      const handle = startRecording(buildRecorderSources);
      recorderHandleRef.current = handle;
      recordStartRef.current = Date.now();
      setRecording(true);
      roomRef.current?.notifyRecordingStarted();
      showMessage(t("meeting.recordingStarted"));
    } catch (err) {
      console.error("start recording failed", err);
      showMessage(t("meeting.recordingStartFailed"));
    }
  };
  const roleLabel =
    snap.role === "host"
      ? t("meeting.roleHost")
      : snap.role
        ? t("meeting.roleParticipant")
        : "";
  const inviteLink = meetingCode
    ? `${window.location.origin}/?join=${meetingCode}`
    : "";

  return (
    <main className="meeting-page">
      <header className="meeting-header">
        <div className="meeting-header-info">
          <h1>{meetingTitle}</h1>
          <p className="meeting-header-meta">
            {meetingCode ? (
              <span className="meeting-code-row">
                <span className="meeting-code">
                  {t("meeting.meetingCode")} {formatMeetingCode(meetingCode)}
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
            {recording && (
              <span className="recording-indicator" title={t("meeting.recording")}>
                <span className="recording-dot" aria-hidden />
                <span>{t("meeting.recording")} {formatDuration(recordElapsed)}</span>
              </span>
            )}
            {roleLabel ? (
              <>
                <span>·</span>
                <span>{roleLabel}</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="meeting-header-actions">
          {inMeeting && isHost && (
            <button
              type="button"
              className="meeting-header-btn"
              onClick={() => {
                const next =
                  snap.layout === "grid"
                    ? "speaker"
                    : snap.layout === "speaker"
                      ? "training"
                      : "grid";
                roomRef.current?.setLayout(next);
              }}
            >
              {snap.layout === "grid"
                ? t("meeting.layoutSpeaker")
                : snap.layout === "speaker"
                  ? t("meeting.layoutTraining")
                  : t("meeting.layoutGrid")}
            </button>
          )}

          <div className="meeting-settings" ref={settingsRef}>
            <button
              type="button"
              className={`meeting-header-btn${settingsOpen ? " is-active" : ""}`}
              onClick={() => setSettingsOpen((v) => !v)}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              aria-label={t("meeting.settings")}
            >
              <SettingOutlined style={{ fontSize: 20 }} />
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
                      void roomRef.current?.switchDevice("audio", id);
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
                      void roomRef.current?.switchDevice("video", id);
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

      <div className="meeting-stage">
        {snap.error && snap.error !== "reconnect_failed" && (
          <p className="error">
            {snap.error === "online_limit_reached"
              ? t("meeting.onlineLimitReached")
              : snap.error}
          </p>
        )}

        {snap.status === "kicked" && (
          <section className="panel meeting-ended">
            <h2>{t("meeting.kicked")}</h2>
            {snap.endedReason ? (
              <p className="muted">{snap.endedReason}</p>
            ) : null}
            <button type="button" onClick={() => navigate("/")}>
              {t("meeting.backHome")}
            </button>
          </section>
        )}

        {snap.status === "error" && snap.error === "reconnect_failed" && (
          <section className="panel meeting-ended">
            <h2>{t("meeting.reconnectFailed")}</h2>
            <button type="button" onClick={() => navigate("/")}>
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
                remoteStreams={snap.remoteStreams}
                screenStreams={snap.screenStreams}
                peers={snap.peers}
                layout={snap.layout}
                focusPeerId={snap.focusPeerId}
                layoutCols={layoutCols}
                onFocusPeer={(peerId) => {
                  roomRef.current?.setFocus(peerId);
                }}
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

            {(membersOpen || chatOpen) && (
              <aside className="meeting-side">
                {membersOpen && (
                  <HostControls
                    isHost={isHost}
                    allowShare={snap.allowShare}
                    allMuted={allMuted}
                    peers={snap.peers}
                    selfPeerId={snap.peerId}
                    invitations={invitations}
                    onClose={() => setMembersOpen(false)}
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
                    onKick={(peerId) => {
                      roomRef.current?.kickPeer(peerId);
                    }}
                  />
                )}
                {chatOpen && (
                  <ChatPanel
                    messages={snap.chatMessages}
                    selfPeerId={snap.peerId}
                    onSend={(text) => roomRef.current?.sendChat(text)}
                    onClose={() => setChatOpen(false)}
                  />
                )}
              </aside>
            )}
          </div>
        )}
      </div>

      {inMeeting && (
        <Controls
          micEnabled={snap.micEnabled}
          camEnabled={snap.camEnabled}
          handRaised={snap.handRaised}
          sharingScreen={snap.sharingScreen}
          canShare={snap.canShare}
          isHost={isHost}
          membersOpen={membersOpen}
          chatOpen={chatOpen}
          unreadChat={unreadChat}
          onToggleMic={() => {
            void roomRef.current?.setMicEnabled(!snap.micEnabled);
          }}
          onToggleCam={() => {
            void roomRef.current?.setCamEnabled(!snap.camEnabled);
          }}
          onToggleHand={() => {
            roomRef.current?.setHandRaised(!snap.handRaised);
          }}
          onToggleScreenShare={() => {
            if (snap.sharingScreen) {
              void roomRef.current?.stopScreenShare();
            } else {
              void roomRef.current?.startScreenShare();
            }
          }}
          onToggleMembers={() => {
            setMembersOpen((v) => !v);
          }}
          onToggleChat={() => {
            setChatOpen((v) => {
              const next = !v;
              if (next) setUnreadChat(0);
              return next;
            });
          }}
          onInvite={() => setInviteOpen(true)}
          onLeave={() => {
            roomRef.current?.leave();
            navigate("/");
          }}
          onEndMeeting={() => {
            roomRef.current?.endMeeting();
          }}
          recording={recording}
          canRecord={canRecord}
          onToggleRecord={handleToggleRecord}
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
