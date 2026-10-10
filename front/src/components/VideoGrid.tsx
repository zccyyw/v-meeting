import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AudioMutedOutlined, DesktopOutlined } from "@ant-design/icons";
import { HandIcon } from "@/components/HandIcon";
import type { MeetingLayout, PeerInfo } from "@/media/room";
import { useSpeaking } from "@/media/useSpeaking";

export type LayoutCols = "auto" | 4 | 6;

export type Tile = {
  key: string;
  peerId: string;
  stream: MediaStream | null;
  label: string;
  /** Local always muted; remotes muted too — audio via RemoteAudios */
  muted?: boolean;
  handRaised: boolean;
  isScreen?: boolean;
  forceAvatar?: boolean;
  /** Whether this peer's microphone is muted (for showing mute indicator). */
  micMuted?: boolean;
  /** Local screen share that may capture the meeting UI itself (monitor or window). */
  localSelfScreen?: boolean;
  /** 该成员到服务器的网络延迟（ms），右上角角标显示 */
  rttMs?: number;
};

type Props = {
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localLabel: string;
  localPeerId: string | null;
  localCamEnabled: boolean;
  localMicEnabled: boolean;
  /** 本端举手状态。服务端 joined 消息的 peers 不含自己，tile 角标需单独传入。 */
  selfHandRaised?: boolean;
  remoteStreams: Map<string, MediaStream>;
  screenStreams: Map<string, MediaStream>;
  peers: PeerInfo[];
  layout: MeetingLayout;
  focusPeerId: string | null;
  layoutCols: LayoutCols;
  /** Peer id of the meeting host / presenter (for PIP placement). */
  hostPeerId?: string | null;
  /**
   * Called when user clicks a tile to set focus, or null to exit focus
   * (training/speaker mode, host only).
   */
  onFocusPeer?: (peerId: string | null) => void;
  /** 各成员网络延迟（ms），key=peerId；驱动画面右上角延迟角标 */
  peerRtt?: Record<string, number>;
  /** 主持人控制的"成员画面轮换"开关 */
  rotationEnabled?: boolean;
  /** 轮换间隔（ms），来自本地设置（5/15/30s） */
  rotationIntervalMs?: number;
};

function hasActiveCamera(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream
    .getVideoTracks()
    .some((t) => t.readyState === "live" && t.enabled);
}

/** 是否存在“存活”的视频轨（用于判定屏幕共享是否仍在进行，忽略已结束的残留流）。 */
function hasLiveVideo(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream.getVideoTracks().some((t) => t.readyState === "live");
}

/** Draggable side list — can be dragged as a floating panel; collapsible. */

export function DraggableSideList({
  tiles,
  focusEnabled,
  focusedPeerId,
  handTitle,
  onFocusPeer,
  variant = "embed",
  rttByPeer,
  rotationEnabled,
  rotationIntervalMs = 15_000,
}: {
  tiles: {
    key: string;
    peerId: string;
    stream: MediaStream | null;
    label: string;
    muted?: boolean;
    handRaised: boolean;
    isScreen?: boolean;
    forceAvatar?: boolean;
    micMuted?: boolean;
    localSelfScreen?: boolean;
    rttMs?: number;
  }[];
  focusEnabled: boolean;
  focusedPeerId?: string | null;
  handTitle: string;
  onFocusPeer?: (peerId: string | null) => void;
  /** 各成员网络延迟（ms），key=peerId */
  rttByPeer?: Record<string, number>;
  /** 主持人控制的轮播开关：开启且内容超出容器时自动平滑滚动循环展示 */
  rotationEnabled?: boolean;
  /** 轮换间隔（ms） */
  rotationIntervalMs?: number;
  /**
   * embed：嵌入右侧列（演讲布局，可拖动/收起）；
   * panel：固定右侧悬浮面板（培训布局，默认收起、不可拖动）。
   */
  variant?: "embed" | "panel";
}) {
  // —— 成员画面自动轮播（图片轮播式）：内容超出容器时每隔"轮换间隔"平滑滚动
  // 一屏循环展示；用户滚轮/触摸/悬停时暂停，交互停止 10 秒后自动恢复 ——
  const listRef = useRef<HTMLDivElement>(null);
  const [userHold, setUserHold] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rotating = Boolean(rotationEnabled);

  const markUserHold = useCallback(() => {
    setUserHold(true);
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => setUserHold(false), 10_000);
  }, []);
  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    },
    [],
  );

  // 稳定 ref 回调（避免每次渲染重建导致 listRef 瞬时为 null，滚动被跳过）
  const setListRef = useCallback((el: HTMLDivElement | null) => {
    dragRef.current = el;
    listRef.current = el;
  }, []);

  useEffect(() => {
    // 仅在用户手动滚动（滚轮/触摸）期间暂停；鼠标悬停不暂停——用户盯着
    // 面板看轮播时鼠标必然停在面板上，悬停暂停会导致"看起来永不滚动"
    if (!rotating || userHold) return;
    const timer = setInterval(() => {
      const el = listRef.current;
      if (!el) return;
      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 4) return;
      const atBottom = el.scrollTop >= maxScroll - 4;
      const target = atBottom ? 0 : Math.min(el.scrollTop + el.clientHeight, maxScroll);
      el.scrollTo({ top: target, behavior: "smooth" });
    }, rotationIntervalMs);
    return () => clearInterval(timer);
  }, [rotating, userHold, rotationIntervalMs, tiles.length]);

  // 轮播关闭时复位滚动位置
  useEffect(() => {
    if (!rotationEnabled && listRef.current) listRef.current.scrollTop = 0;
  }, [rotationEnabled]);

  const { t } = useTranslation();
  const isPanel = variant === "panel";
  const [floating, setFloating] = useState(false);
  // 培训悬浮面板默认收起
  const [collapsed, setCollapsed] = useState(isPanel);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
    if (isPanel) return; // 固定右侧，不支持拖动
    // Only start drag on the header area (the drag handle)
    const target = e.target as HTMLElement;
    if (!target.classList.contains("video-sidelist-drag-handle")) return;
    setFloating(true);
    const el = dragRef.current;
    if (!el) return;
    // Use offsetLeft/Top (relative to the positioned .video-grid container) so
    // the absolute left/top style matches, avoiding a jump on first drag.
    dragStart.current = { x: e.clientX, y: e.clientY, px: el.offsetLeft, py: el.offsetTop };
    e.preventDefault();
    },
    [isPanel],
  );

  useEffect(() => {
    if (!floating || !dragStart.current) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPos({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
    };
    const onUp = () => {
      dragStart.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [floating]);

  const style: React.CSSProperties = isPanel
    ? // 培训悬浮面板：固定右侧，展开时占满可用高度（内部滚动）；
      // 收起时贴右侧垂直居中，与展开态的左侧切换页签位置对应
      collapsed
      ? { position: "absolute", top: "50%", right: "0.75rem", zIndex: 50, transform: "translateY(-50%)" }
      : { position: "absolute", top: "0.75rem", right: "0.75rem", bottom: "0.75rem", zIndex: 50 }
    : floating
      ? { position: "absolute", right: "auto", bottom: "auto", left: pos.x, top: pos.y, zIndex: 50, opacity: 0.95 }
      : {};

  if (collapsed && isPanel) {
    // 培训面板收起：只渲染展开页签（绝对定位，不占布局宽度）
    return (
      <button
        type="button"
        className="video-sidelist-toggle video-sidelist-toggle--tab"
        style={{ right: "0.75rem" }}
        onClick={() => setCollapsed(false)}
        title={t("meeting.expandList")}
        aria-label={t("meeting.expandList")}
      >
        ‹
      </button>
    );
  }

  return (
    <div
      ref={setListRef}
      className={`video-sidelist${floating ? " video-sidelist--floating" : ""}${
        isPanel ? " video-sidelist--panel" : ""
      }`}
      style={style}
      onWheel={markUserHold}
      onTouchStart={markUserHold}
    >
      {!isPanel ? (
        // 演讲者布局：仅保留拖动手柄，不提供收起/展开
        <div className="video-sidelist-toolbar">
          <div
            className="video-sidelist-drag-handle"
            onMouseDown={onMouseDown}
            title={t("meeting.dragHandle")}
          >
            <span className="video-sidelist-drag-icon" aria-hidden />
          </div>
        </div>
      ) : (
        // 培训面板：切换页签固定在列表左缘垂直居中
        <button
          type="button"
          className="video-sidelist-toggle video-sidelist-toggle--tab"
          style={{ left: "-1.45rem" }}
          onClick={() => setCollapsed(true)}
          title={t("meeting.collapseList")}
          aria-label={t("meeting.collapseList")}
        >
          ›
        </button>
      )}
      {tiles.map((tile) => (
        <VideoTile
          key={tile.key}
          stream={tile.stream}
          label={tile.label}
          muted={tile.muted}
          micMuted={tile.micMuted}
          handRaised={tile.handRaised}
          handTitle={handTitle}
          showAvatar={tile.forceAvatar}
          compact
          focused={focusedPeerId != null && tile.peerId === focusedPeerId}
          focusable={focusEnabled}
          rttMs={rttByPeer?.[tile.peerId]}
          onClick={
            focusEnabled && onFocusPeer
              ? () => onFocusPeer(tile.peerId)
              : undefined
          }
        />
      ))}
    </div>
  );
}

/**
 * Presenter PIP (picture-in-picture) — floats over the main stage, defaults to
 * the bottom-right corner and can be dragged anywhere.
 */
function DraggablePip({
  tile,
  handTitle,
  rotationTiles,
  rotationIntervalMs = 15_000,
  participantsCount,
}: {
  tile: Tile;
  handTitle: string;
  /** 主讲人视角：其他成员摄像头轮换池（排除自己与共享画面） */
  rotationTiles?: Tile[];
  /** 轮换间隔（ms） */
  rotationIntervalMs?: number;
  /** 参会总人数（overlay 显示） */
  participantsCount?: number;
}) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  // 区分"拖动"与"点击"：拖动过的 mouseup 不触发模式切换
  const movedRef = useRef(false);
  // PiP 模式：rotation=轮换看学员；self=自己摄像头
  // 注意：PiP 在开始共享之前就已挂载（此时 rotationTiles 为空），若只在
  // useState 初始化时判定 mode，之后成员进入池也不会切到轮换 —— 必须
  // 随 hasRotation 变化自动切换（用户手动点过之后尊重用户选择）。
  const hasRotation = Boolean(rotationTiles && rotationTiles.length > 0);
  const [mode, setMode] = useState<"rotation" | "self">(hasRotation ? "rotation" : "self");
  const userPicked = useRef(false);
  useEffect(() => {
    if (!hasRotation) {
      userPicked.current = false;
      setMode("self");
    } else if (!userPicked.current) {
      setMode("rotation");
    }
  }, [hasRotation]);
  const [rotIdx, setRotIdx] = useState(0);
  const rotKey = rotationTiles?.map((t) => t.key).join("|") ?? "";
  // rotationTiles 每次父组件渲染都是新数组引用，直接作为 effect 依赖会导致
  // interval 每次渲染都被重建（永远等不到一个周期）——用稳定的 rotKey 做依赖，
  // 最新数组走 ref 读取。
  const rotTilesRef = useRef(rotationTiles);
  rotTilesRef.current = rotationTiles;
  useEffect(() => {
    setRotIdx(0);
  }, [rotKey]);
  useEffect(() => {
    const len = rotTilesRef.current?.length ?? 0;
    if (mode !== "rotation" || len <= 1) return;
    const timer = setInterval(() => {
      const n = rotTilesRef.current?.length ?? 0;
      if (n <= 1) return;
      setRotIdx((i) => (i + 1) % n);
    }, rotationIntervalMs);
    return () => clearInterval(timer);
  }, [mode, rotKey, rotationIntervalMs]);
  const currentTile =
    mode === "rotation" && rotationTiles && rotationTiles.length > 0
      ? rotationTiles[rotIdx % rotationTiles.length]
      : tile;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    movedRef.current = false;
    // offsetLeft/Top are relative to the positioned .video-grid container,
    // matching the absolute left/top style (avoids a jump on first drag).
    dragStart.current = { x: e.clientX, y: e.clientY, px: el.offsetLeft, py: el.offsetTop };
    setPos({ x: el.offsetLeft, y: el.offsetTop });
    setDragging(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      // 标记"发生过拖动"：否则拖动 PiP 松手会误触发点击 -> 意外切换轮播/自视模式
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current = true;
      setPos({ x: dragStart.current.px + dx, y: dragStart.current.py + dy });
    };
    const onUp = () => {
      dragStart.current = null;
      setDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const style: React.CSSProperties = pos
    ? { right: "auto", bottom: "auto", left: pos.x, top: pos.y }
    : {};

  return (
    <div
      ref={ref}
      className="video-pip"
      style={style}
      onMouseDown={onMouseDown}
      onClick={() => {
        if (hasRotation && !movedRef.current) {
          userPicked.current = true;
          setMode((m) => (m === "rotation" ? "self" : "rotation"));
        }
      }}
      title={hasRotation ? t("meeting.pipSwitchHint") : t("meeting.dragHandle")}
    >
      <VideoTile
        stream={currentTile.stream}
        label={currentTile.label}
        muted={currentTile.muted}
        micMuted={currentTile.micMuted}
        handRaised={currentTile.handRaised}
        handTitle={handTitle}
        showAvatar={!currentTile.isScreen && currentTile.forceAvatar}
        isScreen={currentTile.isScreen}
        localSelfScreen={currentTile.localSelfScreen}
        camOff={!currentTile.isScreen && Boolean(currentTile.forceAvatar)}
        rttMs={currentTile.rttMs}
      />
      {mode === "rotation" && rotationTiles && rotationTiles.length > 0 && (
        <div className="video-pip-overlay">
          {t("meeting.participantsCount", { count: participantsCount ?? 0 })}
        </div>
      )}
    </div>
  );
}

function avatarLetter(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const ch = trimmed[0]!;
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
}

/** Play remote audio even when the peer tile shows avatar (no <video>). */
function RemoteAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    const tryPlay = () => {
      void el.play().catch(() => {
        /* 需要用户激活，由下方手势/收流事件兜底重试 */
      });
    };
    tryPlay();
    // 自动播放策略：无用户激活时 play() 会被拒绝且此后不再自动成功。
    // 说话图标能工作说明音频数据已到达，此处必须在首次用户手势
    // 或音轨开始收流（unmute 事件）时重试播放，否则永远无声。
    const onGesture = () => tryPlay();
    document.addEventListener("pointerdown", onGesture);
    document.addEventListener("keydown", onGesture);
    const track = stream.getAudioTracks()[0];
    track?.addEventListener("unmute", tryPlay);
    return () => {
      document.removeEventListener("pointerdown", onGesture);
      document.removeEventListener("keydown", onGesture);
      track?.removeEventListener("unmute", tryPlay);
      el.srcObject = null;
    };
  }, [stream]);

  return <audio ref={ref} autoPlay playsInline />;
}

function RemoteAudios({ streams }: { streams: Map<string, MediaStream> }) {
  return (
    <div className="remote-audios" aria-hidden>
      {[...streams.entries()].map(([peerId, stream]) => (
        <RemoteAudio key={peerId} stream={stream} />
      ))}
    </div>
  );
}

function VideoTile({
  stream,
  label,
  muted,
  micMuted,
  handRaised,
  focused,
  handTitle,
  showAvatar,
  compact,
  isScreen,
  localSelfScreen,
  camOff,
  onClick,
  focusable,
  actionTitle,
  rttMs,
}: {
  stream: MediaStream | null;
  rttMs?: number;
  label: string;
  muted?: boolean;
  micMuted?: boolean;
  handRaised?: boolean;
  focused?: boolean;
  handTitle: string;
  showAvatar?: boolean;
  compact?: boolean;
  isScreen?: boolean;
  localSelfScreen?: boolean;
  camOff?: boolean;
  onClick?: () => void;
  focusable?: boolean;
  actionTitle?: string;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLVideoElement>(null);
  const avatar = !isScreen && Boolean(showAvatar);
  const showPlaceholder = Boolean(isScreen && localSelfScreen);
  const speaking = useSpeaking(isScreen ? null : stream);
  const isMuted = Boolean(micMuted);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (avatar || showPlaceholder) {
      el.srcObject = null;
      return;
    }

    // 显式设置 muted DOM 属性 — React 的 muted 属性存在已知 bug，
    // 不会正确设置 DOM property，导致 autoPlay 在严格自动播放策略的
    // 浏览器（如奇安信 Chrome 102）中静默失败。
    el.muted = Boolean(muted);
    el.srcObject = stream;

    // 显式调用 play() 作为 autoPlay 的兜底
    const tryPlay = () => {
      void el.play().catch(() => {
        /* 自动播放策略可能要求用户交互；入会操作即视为用户交互 */
      });
    };

    // 如果 metadata 已加载，直接 play；否则等待 loadedmetadata 事件
    if (el.readyState >= 1) {
      tryPlay();
    } else {
      el.addEventListener("loadedmetadata", tryPlay, { once: true });
    }

    return () => {
      el.removeEventListener("loadedmetadata", tryPlay);
    };
  }, [stream, avatar, showPlaceholder, muted]);

  return (
    <div
      className={`video-tile${focused ? " video-tile--focus" : ""}${
        compact ? " video-tile--compact" : ""
      }${avatar ? " video-tile--avatar" : ""}${isScreen ? " video-tile--screen" : ""}${
        showPlaceholder ? " video-tile--self-screen" : ""
      }${focusable ? " video-tile--focusable" : ""}`}
      onClick={onClick}
      role={focusable ? "button" : undefined}
      tabIndex={focusable ? 0 : undefined}
      title={focusable ? (actionTitle ?? t("meeting.focusSpeaker")) : undefined}
    >
      {!avatar && !showPlaceholder && (
        <video ref={ref} autoPlay playsInline muted={muted} />
      )}
      {avatar && (
        <div className="video-tile-avatar" aria-hidden>
          {avatarLetter(label)}
        </div>
      )}
      {showPlaceholder && (
        <div className="screen-share-placeholder" role="status">
          <DesktopOutlined className="screen-share-placeholder-icon" aria-hidden />
          <span className="screen-share-placeholder-text">
            {t("meeting.sharingSelfScreen")}
          </span>
        </div>
      )}
      <span className={`video-label${camOff ? " video-label--cam-off" : ""}`}>{label}</span>
      {rttMs != null && (
        <span
          className={`video-tile-rtt ${rttMs < 100 ? "rtt-good" : rttMs < 300 ? "rtt-mid" : "rtt-bad"}`}
          title={t("meeting.networkDelay")}
        >
          {rttMs}ms
        </span>
      )}
      {handRaised && (
        <span className="hand-badge" title={handTitle}>
          <HandIcon />
        </span>
      )}
      {!isScreen && (
        <div className="audio-indicator" aria-hidden>
          {isMuted ? (
            <AudioMutedOutlined className="audio-indicator-muted" />
          ) : speaking ? (
            <span className="audio-indicator-bars">
              <span className="audio-indicator-bar" />
              <span className="audio-indicator-bar" />
              <span className="audio-indicator-bar" />
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function VideoGrid({
  localStream,
  localScreenStream,
  localLabel,
  localPeerId,
  localCamEnabled,
  localMicEnabled,
  selfHandRaised,
  remoteStreams,
  screenStreams,
  peers,
  layout,
  focusPeerId,
  layoutCols,
  hostPeerId,
  onFocusPeer,
  peerRtt,
  rotationEnabled,
  rotationIntervalMs,
}: Props) {
  const { t } = useTranslation();
  const handTitle = t("meeting.hand");
  const [trackEpoch, setTrackEpoch] = useState(0);

  useEffect(() => {
    const streams = [
      localStream,
      localScreenStream,
      ...remoteStreams.values(),
      ...screenStreams.values(),
    ].filter(Boolean) as MediaStream[];

    const onChange = () => setTrackEpoch((n) => n + 1);
    const tracks: MediaStreamTrack[] = [];
    for (const stream of streams) {
      for (const track of stream.getVideoTracks()) {
        tracks.push(track);
        track.addEventListener("mute", onChange);
        track.addEventListener("unmute", onChange);
        track.addEventListener("ended", onChange);
      }
    }
    return () => {
      for (const track of tracks) {
        track.removeEventListener("mute", onChange);
        track.removeEventListener("unmute", onChange);
        track.removeEventListener("ended", onChange);
      }
    };
  }, [localStream, localScreenStream, remoteStreams, screenStreams]);

  const peerName = (peerId: string) =>
    peers.find((p) => p.peerId === peerId)?.displayName ?? peerId.slice(0, 8);

  const peerHand = (peerId: string) =>
    peers.find((p) => p.peerId === peerId)?.handRaised ?? false;

  const peerCamEnabled = (peerId: string) =>
    peers.find((p) => p.peerId === peerId)?.camEnabled ?? false;

  const peerMicEnabled = (peerId: string) =>
    peers.find((p) => p.peerId === peerId)?.micEnabled ?? true;

  // Conservative: any local screen share (monitor, window, or browser) may
  // capture the meeting UI itself and cause an infinite mirror loop. All are
  // treated as self-capturing so the local preview is replaced by a placeholder.
  const localScreenIsSelf = (() => {
    if (!localScreenStream) return false;
    const track = localScreenStream.getVideoTracks()[0];
    const surface = track?.getSettings?.().displaySurface;
    // 老内核/信创浏览器（如奇安信涉密版）getSettings() 不返回 displaySurface，
    // 此时无法判断共享面类型 —— 保守视为自捕获。
    // 自捕获时该 tile 不进入视频网格（方案 1），共享状态由控制栏/沉浸条呈现。
    if (surface == null) return true;
    return surface === "monitor" || surface === "window" || surface === "browser";
  })();

  const tiles: Tile[] = [
    {
      key: "local",
      peerId: localPeerId ?? "local",
      stream: localStream,
      label: t("meeting.youSuffix", { name: localLabel }),
      muted: true,
      micMuted: !localMicEnabled,
      handRaised: Boolean(selfHandRaised) || Boolean(localPeerId && peerHand(localPeerId)),
      forceAvatar: !localCamEnabled || !hasActiveCamera(localStream),
      rttMs: localPeerId != null ? peerRtt?.[localPeerId] : undefined,
    },
  ];

  if (localScreenStream && hasLiveVideo(localScreenStream) && !localScreenIsSelf) {
    // 非自捕获（如共享其他应用窗口且浏览器能识别共享面）时显示本地共享预览；
    // 自捕获时跳过：共享流会被自身采集，渲染它会形成无限嵌套画面。
    tiles.push({
      key: "local-screen",
      peerId: localPeerId ?? "local",
      stream: localScreenStream,
      label: t("meeting.screenShareOf", { name: localLabel }),
      muted: true,
      handRaised: false,
      isScreen: true,
      localSelfScreen: false,
    });
  }

  // 参与者花名册：以 peers 为准。未开摄像头的成员同样生成瓦片（瓦片内用头像占位），
  // 使“开摄像头”与“未开摄像头”共用同一套布局与渲染，不再单独维护头像模式。
  const roster = new Map<
    string,
    {
      label: string;
      micEnabled: boolean;
      handRaised: boolean;
      camEnabled: boolean;
    }
  >();
  for (const peer of peers) {
    if (peer.peerId === localPeerId) continue;
    roster.set(peer.peerId, {
      label: peer.displayName,
      micEnabled: peer.micEnabled,
      handRaised: peer.handRaised,
      camEnabled: peer.camEnabled,
    });
  }
  // 兜底：有视频轨但不在 peers 里的 peer（状态未同步时）也要出瓦片
  for (const peerId of remoteStreams.keys()) {
    if (peerId === localPeerId || roster.has(peerId)) continue;
    roster.set(peerId, {
      label: peerName(peerId),
      micEnabled: peerMicEnabled(peerId),
      handRaised: peerHand(peerId),
      camEnabled: peerCamEnabled(peerId),
    });
  }
  for (const [peerId, info] of roster) {
    const stream = remoteStreams.get(peerId) ?? null;
    tiles.push({
      key: peerId,
      peerId,
      stream,
      label: info.label,
      muted: true,
      micMuted: !info.micEnabled,
      handRaised: info.handRaised,
      forceAvatar: !info.camEnabled || !hasActiveCamera(stream),
      rttMs: peerRtt?.[peerId],
    });
  }

  for (const [peerId, stream] of screenStreams) {
    // 跳过已结束的共享流（残留条目），避免主画面停留在黑屏且强制侧栏布局
    if (!hasLiveVideo(stream)) continue;
    tiles.push({
      key: `${peerId}-screen`,
      peerId,
      stream,
      label: t("meeting.screenShareOf", { name: peerName(peerId) }),
      muted: true,
      handRaised: false,
      isScreen: true,
    });
  }

  void trackEpoch;
  // 以“是否存在存活的共享视频轨”判定投屏态，避免残留流把布局永久锁在侧栏
  const hasScreen =
    hasLiveVideo(localScreenStream) ||
    [...screenStreams.values()].some((s) => hasLiveVideo(s));
  const remoteAudio = <RemoteAudios streams={remoteStreams} />;

  const screenTile =
    (focusPeerId &&
      tiles.find((t) => t.isScreen && t.peerId === focusPeerId)) ||
    tiles.find((t) => t.isScreen) ||
    null;

  // Presenter (host) camera tile for PIP display.
  const hostTile =
    hostPeerId != null
      ? tiles.find((t) => t.peerId === hostPeerId && !t.isScreen)
      : undefined;

  const resolvedFocusPeer =
    focusPeerId && tiles.some((t) => t.peerId === focusPeerId)
      ? focusPeerId
      : hostPeerId != null && tiles.some((t) => t.peerId === hostPeerId && !t.isScreen)
        ? hostPeerId
        : (tiles[0]?.peerId ?? null);

  const useSideLayout = layout === "speaker" || layout === "training" || hasScreen;

  // 点击切换主画面：培训模式与演讲者布局均开放（onFocusPeer 仅主持人注入，
  // 服务端 setFocus 亦做 host 校验）。
  const focusEnabled =
    (layout === "training" || layout === "speaker") && onFocusPeer != null;
  // 是否为"显式焦点"（主持人点选的成员，而非默认回退的主画面）。
  const explicitFocus =
    focusPeerId != null && tiles.some((t) => t.peerId === focusPeerId && !t.isScreen);

  const focusTile = useSideLayout
    ? (screenTile ??
      tiles.find((t) => t.peerId === resolvedFocusPeer && !t.isScreen) ??
      tiles[0])
    : null;

  // PIP 主体：投屏时优先展示“共享者”的摄像头（主讲人小窗语义），
  // 共享者无摄像头轨时回退到主持人摄像头。
  const screenOwnerId = screenTile?.peerId ?? null;
  const pipTile =
    hasScreen && screenOwnerId != null
      ? tiles.find((t) => t.peerId === screenOwnerId && !t.isScreen) ?? hostTile
      : hostTile;

  // 主讲人（自己正在共享）视角：PiP 改为其他成员摄像头轮换池，
  // 点击可在"成员轮换 ↔ 自己摄像头"间切换（默认成员轮换）。
  // 注意：不能用 screenTile 判定——本地自捕获共享（显示器/窗口）不产生
  // screen tile（跳过推送以避免无限嵌套），必须直接检测本地共享流。
  const selfSharing =
    hasScreen && Boolean(localScreenStream && hasLiveVideo(localScreenStream));
  const rotationPool = selfSharing
    ? tiles.filter((t) => !t.isScreen && t.peerId !== localPeerId)
    : [];
  const selfCamTile = tiles.find((t) => t.peerId === localPeerId && !t.isScreen);
  const participantsCount = tiles.filter((t) => !t.isScreen).length;

  // 主舞台展示共享画面或他人画面时悬浮小窗：
  //  - 培训布局：始终显示（原有行为）
  //  - 任意布局：只要有投屏就显示（grid/speaker 投屏时也会走侧栏分支），
  //    修复“投屏时其他成员看不到画中画”的问题
  const showPip =
    (layout === "training" || hasScreen) &&
    Boolean(pipTile) &&
    focusTile != null &&
    (selfSharing
      ? Boolean(selfCamTile) || rotationPool.length > 0
      : focusTile.key !== pipTile!.key);

  // 右侧成员显示全部人员（含主持人/自己），仅排除共享画面 tile；
  // 点击不同成员（含主持人）即可切换主画面
  const stripTiles = useSideLayout ? tiles.filter((t) => !t.isScreen) : tiles;

  if (useSideLayout && focusTile) {
    const isTraining = layout === "training";
    return (
      <>
        {remoteAudio}
        <div className={`video-grid ${isTraining ? "video-grid--training" : "video-grid--side"}`}>
          <div className="video-side-main">
            <VideoTile
              stream={focusTile.stream}
              label={focusTile.label}
              muted={focusTile.muted}
              handRaised={focusTile.handRaised}
              handTitle={handTitle}
              focused
              showAvatar={!focusTile.isScreen && focusTile.forceAvatar}
              isScreen={focusTile.isScreen}
              localSelfScreen={focusTile.localSelfScreen}
              micMuted={focusTile.micMuted}
            />
          </div>
          {stripTiles.length > 0 && (
            <DraggableSideList
              tiles={stripTiles}
              focusEnabled={focusEnabled}
              focusedPeerId={explicitFocus ? focusPeerId : null}
              handTitle={handTitle}
              onFocusPeer={onFocusPeer}
              variant={isTraining ? "panel" : "embed"}
              rttByPeer={peerRtt}
              rotationEnabled={rotationEnabled}
              rotationIntervalMs={rotationIntervalMs}
            />
          )}
          {showPip && pipTile && (
            <DraggablePip
              tile={selfSharing ? (selfCamTile ?? pipTile) : pipTile}
              handTitle={handTitle}
              rotationTiles={selfSharing ? rotationPool : undefined}
              rotationIntervalMs={rotationIntervalMs}
              participantsCount={participantsCount}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {remoteAudio}
      <div
        className="video-grid video-grid--grid"
        data-cols={layoutCols}
      >
        {tiles.map((tile) => (
          <VideoTile
            key={tile.key}
            stream={tile.stream}
            label={tile.label}
            muted={tile.muted}
            handRaised={tile.handRaised}
            handTitle={handTitle}
            showAvatar={!tile.isScreen && tile.forceAvatar}
            isScreen={tile.isScreen}
            localSelfScreen={tile.localSelfScreen}
            rttMs={tile.rttMs}
            micMuted={tile.micMuted}
            camOff={!tile.isScreen && Boolean(tile.forceAvatar)}
          />
        ))}
      </div>
    </>
  );
}
