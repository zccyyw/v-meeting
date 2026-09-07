import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { AudioMutedOutlined, DesktopOutlined, AlertOutlined } from "@ant-design/icons";
import type { MeetingLayout, PeerInfo } from "@/media/room";
import { useSpeaking } from "@/media/useSpeaking";

export type LayoutCols = "auto" | 4 | 6;

type Tile = {
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
};

type Props = {
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  localLabel: string;
  localPeerId: string | null;
  localCamEnabled: boolean;
  localMicEnabled: boolean;
  remoteStreams: Map<string, MediaStream>;
  screenStreams: Map<string, MediaStream>;
  peers: PeerInfo[];
  layout: MeetingLayout;
  focusPeerId: string | null;
  layoutCols: LayoutCols;
  /** Peer id of the meeting host / presenter (for PIP placement). */
  hostPeerId?: string | null;
  /** Called when user clicks a tile to set focus (training/speaker mode, host only). */
  onFocusPeer?: (peerId: string) => void;
};

function hasActiveCamera(stream: MediaStream | null | undefined): boolean {
  if (!stream) return false;
  return stream
    .getVideoTracks()
    .some((t) => t.readyState === "live" && t.enabled);
}

/** Draggable side list — can be dragged as a floating panel; collapsible. */
function DraggableSideList({
  tiles,
  isTraining,
  handTitle,
  onFocusPeer,
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
  }[];
  isTraining: boolean;
  handTitle: string;
  onFocusPeer?: (peerId: string) => void;
}) {
  const { t } = useTranslation();
  const [floating, setFloating] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
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
  }, []);

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

  const style: React.CSSProperties = floating
    ? { position: "absolute", right: "auto", bottom: "auto", left: pos.x, top: pos.y, zIndex: 50, opacity: 0.95 }
    : {};

  if (collapsed) {
    return (
      <div className="video-sidelist video-sidelist--collapsed" style={style}>
        <div
          className="video-sidelist-drag-handle"
          onMouseDown={onMouseDown}
          title={t("meeting.dragHandle")}
        >
          <span className="video-sidelist-drag-icon" aria-hidden />
        </div>
        <button
          type="button"
          className="video-sidelist-toggle"
          onClick={() => setCollapsed(false)}
          title={t("meeting.expandList")}
          aria-label={t("meeting.expandList")}
        >
          ‹
        </button>
      </div>
    );
  }

  return (
    <div
      ref={dragRef}
      className={`video-sidelist${floating ? " video-sidelist--floating" : ""}`}
      style={style}
    >
      <div className="video-sidelist-toolbar">
        <div
          className="video-sidelist-drag-handle"
          onMouseDown={onMouseDown}
          title={t("meeting.dragHandle")}
        >
          <span className="video-sidelist-drag-icon" aria-hidden />
        </div>
        <button
          type="button"
          className="video-sidelist-toggle"
          onClick={() => setCollapsed(true)}
          title={t("meeting.collapseList")}
          aria-label={t("meeting.collapseList")}
        >
          ›
        </button>
      </div>
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
          focusable={isTraining && onFocusPeer != null}
          onClick={
            isTraining && onFocusPeer
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
function DraggablePip({ tile, handTitle }: { tile: Tile; handTitle: string }) {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
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
      title={t("meeting.dragHandle")}
    >
      <VideoTile
        stream={tile.stream}
        label={tile.label}
        muted={tile.muted}
        micMuted={tile.micMuted}
        handRaised={tile.handRaised}
        handTitle={handTitle}
        showAvatar={!tile.isScreen && tile.forceAvatar}
        isScreen={tile.isScreen}
        localSelfScreen={tile.localSelfScreen}
        camOff={!tile.isScreen && Boolean(tile.forceAvatar)}
      />
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
    void el.play().catch(() => {
      /* autoplay may need a prior user gesture; joining counts */
    });
    return () => {
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
}: {
  stream: MediaStream | null;
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
      title={focusable ? t("meeting.focusSpeaker") : undefined}
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
      {handRaised && (
        <span className="hand-badge" title={handTitle}>
          <AlertOutlined aria-hidden />
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

function AvatarStage({
  people,
}: {
  people: {
    key: string;
    name: string;
    handRaised: boolean;
    stream: MediaStream | null;
    micMuted: boolean;
  }[];
}) {
  const { t } = useTranslation();
  return (
    <div
      className="avatar-stage"
      role="group"
      aria-label={t("meeting.avatarStage")}
    >
      <div className="avatar-stage-row">
        {people.map((p) => (
          <AvatarPerson
            key={p.key}
            name={p.name}
            handRaised={p.handRaised}
            stream={p.stream}
            micMuted={p.micMuted}
          />
        ))}
      </div>
    </div>
  );
}

function AvatarPerson({
  name,
  handRaised,
  stream,
  micMuted,
}: {
  name: string;
  handRaised: boolean;
  stream: MediaStream | null;
  micMuted: boolean;
}) {
  const speaking = useSpeaking(stream);
  return (
    <div className="avatar-person">
      <div className="avatar-circle" aria-hidden>
        {avatarLetter(name)}
        {handRaised && <span className="avatar-hand"><AlertOutlined aria-hidden /></span>}
        <div className="audio-indicator audio-indicator--avatar" aria-hidden>
          {micMuted ? (
            <AudioMutedOutlined className="audio-indicator-muted" />
          ) : speaking ? (
            <span className="audio-indicator-bars">
              <span className="audio-indicator-bar" />
              <span className="audio-indicator-bar" />
              <span className="audio-indicator-bar" />
            </span>
          ) : null}
        </div>
      </div>
      <span className="avatar-name">{name}</span>
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
  remoteStreams,
  screenStreams,
  peers,
  layout,
  focusPeerId,
  layoutCols,
  hostPeerId,
  onFocusPeer,
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
      handRaised: Boolean(localPeerId && peerHand(localPeerId)),
      forceAvatar: !localCamEnabled,
    },
  ];

  if (localScreenStream) {
    tiles.push({
      key: "local-screen",
      peerId: localPeerId ?? "local",
      stream: localScreenStream,
      label: t("meeting.screenShareOf", { name: localLabel }),
      muted: true,
      handRaised: false,
      isScreen: true,
      localSelfScreen: localScreenIsSelf,
    });
  }

  for (const [peerId, stream] of remoteStreams) {
    tiles.push({
      key: peerId,
      peerId,
      stream,
      label: peerName(peerId),
      muted: true,
      micMuted: !peerMicEnabled(peerId),
      handRaised: peerHand(peerId),
      forceAvatar: !peerCamEnabled(peerId),
    });
  }

  for (const [peerId, stream] of screenStreams) {
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
  const hasScreen = Boolean(localScreenStream) || screenStreams.size > 0;
  const localVideoOn = localCamEnabled && hasActiveCamera(localStream);
  let remoteVideoOn = false;
  for (const p of peers) {
    if (p.peerId === localPeerId) continue;
    if (p.camEnabled) {
      remoteVideoOn = true;
      break;
    }
  }

  const avatarMode = !hasScreen && !localVideoOn && !remoteVideoOn;
  const remoteAudio = <RemoteAudios streams={remoteStreams} />;

  if (avatarMode) {
    const people: {
      key: string;
      name: string;
      handRaised: boolean;
      stream: MediaStream | null;
      micMuted: boolean;
    }[] = [
      {
        key: "local",
        name: t("meeting.youSuffix", { name: localLabel }),
        handRaised: Boolean(localPeerId && peerHand(localPeerId)),
        stream: localStream,
        micMuted: !localMicEnabled,
      },
    ];
    const seen = new Set<string>([localPeerId ?? ""]);
    for (const peer of peers) {
      if (peer.peerId === localPeerId) continue;
      if (seen.has(peer.peerId)) continue;
      seen.add(peer.peerId);
      people.push({
        key: peer.peerId,
        name: peer.displayName,
        handRaised: peer.handRaised,
        stream: remoteStreams.get(peer.peerId) ?? null,
        micMuted: !peer.micEnabled,
      });
    }
    for (const peerId of remoteStreams.keys()) {
      if (seen.has(peerId)) continue;
      seen.add(peerId);
      people.push({
        key: peerId,
        name: peerName(peerId),
        handRaised: peerHand(peerId),
        stream: remoteStreams.get(peerId) ?? null,
        micMuted: !peerMicEnabled(peerId),
      });
    }
    return (
      <>
        {remoteAudio}
        <AvatarStage people={people} />
      </>
    );
  }

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

  const focusTile = useSideLayout
    ? (screenTile ??
      tiles.find((t) => t.peerId === resolvedFocusPeer && !t.isScreen) ??
      tiles[0])
    : null;

  // Show the presenter as a draggable PIP whenever the main stage shows
  // something else (shared screen or a focused speaker).
  const showPip =
    useSideLayout && Boolean(hostTile) && focusTile != null && focusTile.key !== hostTile!.key;

  const stripTiles = useSideLayout
    ? tiles.filter(
        (t) =>
          t.key !== focusTile?.key &&
          !t.isScreen &&
          !(showPip && hostTile && t.key === hostTile.key),
      )
    : tiles;

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
              focusable={isTraining && !focusTile.isScreen && onFocusPeer != null}
              onClick={
                isTraining && !focusTile.isScreen && onFocusPeer
                  ? () => onFocusPeer(focusTile.peerId)
                  : undefined
              }
            />
          </div>
          {stripTiles.length > 0 && (
            <DraggableSideList tiles={stripTiles} isTraining={isTraining} handTitle={handTitle} onFocusPeer={onFocusPeer} />
          )}
          {showPip && hostTile && (
            <DraggablePip tile={hostTile} handTitle={handTitle} />
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
            micMuted={tile.micMuted}
            camOff={!tile.isScreen && Boolean(tile.forceAvatar)}
          />
        ))}
      </div>
    </>
  );
}
