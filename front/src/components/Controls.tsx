import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { App } from "antd";
import {
  AudioOutlined,
  AudioMutedOutlined,
  VideoCameraOutlined,
  DesktopOutlined,
  UserAddOutlined,
  TeamOutlined,
  MessageOutlined,
  AlertOutlined,
  LogoutOutlined,
  PoweroffOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";

const ICON_STYLE = { fontSize: 22 } as const;

type Props = {
  micEnabled: boolean;
  camEnabled: boolean;
  handRaised: boolean;
  sharingScreen: boolean;
  canShare: boolean;
  isHost: boolean;
  membersOpen: boolean;
  chatOpen: boolean;
  unreadChat: number;
  recording: boolean;
  canRecord: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleHand: () => void;
  onToggleScreenShare: () => void;
  onToggleMembers: () => void;
  onToggleChat: () => void;
  onInvite: () => void;
  onLeave: () => void;
  onEndMeeting: () => void;
  onToggleRecord: () => void;
};

function ControlButton({
  label,
  icon,
  onClick,
  className = "",
  disabled,
  ariaLabel,
  ariaPressed,
  badge,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  badge?: number;
}) {
  return (
    <button
      type="button"
      className={`control-btn ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      aria-pressed={ariaPressed}
    >
      <span className="control-btn-icon">
        {icon}
        {badge != null && badge > 0 && (
          <span className="control-btn-badge" aria-hidden>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </span>
      <span className="control-btn-label">{label}</span>
    </button>
  );
}

export function Controls({
  micEnabled,
  camEnabled,
  handRaised,
  sharingScreen,
  canShare,
  isHost,
  membersOpen,
  chatOpen,
  unreadChat,
  onToggleMic,
  onToggleCam,
  onToggleHand,
  onToggleScreenShare,
  onToggleMembers,
  onToggleChat,
  onInvite,
  onLeave,
  onEndMeeting,
  onToggleRecord,
  recording,
  canRecord,
}: Props) {
  const { t } = useTranslation();
  const { modal } = App.useApp();

  return (
    <div className="controls" role="toolbar" aria-label={t("meeting.title")}>
      <div className="controls-cluster">
        <ControlButton
          label={t("meeting.mic")}
          icon={
            micEnabled ? (
              <AudioOutlined style={ICON_STYLE} aria-hidden />
            ) : (
              <AudioMutedOutlined style={ICON_STYLE} aria-hidden />
            )
          }
          className={micEnabled ? "" : "is-off"}
          onClick={onToggleMic}
          ariaLabel={micEnabled ? t("meeting.mute") : t("meeting.unmute")}
          ariaPressed={!micEnabled}
        />
        <ControlButton
          label={t("meeting.camera")}
          icon={
            camEnabled ? (
              <VideoCameraOutlined style={ICON_STYLE} aria-hidden />
            ) : (
              <VideoCameraOutlined style={ICON_STYLE} aria-hidden />
            )
          }
          className={camEnabled ? "" : "is-off"}
          onClick={onToggleCam}
          ariaLabel={camEnabled ? t("meeting.camOff") : t("meeting.camOn")}
          ariaPressed={!camEnabled}
        />
        <ControlButton
          label={t("meeting.shareShort")}
          icon={<DesktopOutlined style={ICON_STYLE} aria-hidden />}
          className={sharingScreen ? "is-active" : ""}
          onClick={onToggleScreenShare}
          disabled={!sharingScreen && !canShare}
          ariaLabel={sharingScreen ? t("meeting.stopShare") : t("meeting.share")}
          ariaPressed={sharingScreen}
        />
        <ControlButton
          label={t("meeting.invite")}
          icon={<UserAddOutlined style={ICON_STYLE} aria-hidden />}
          onClick={onInvite}
        />
        <ControlButton
          label={recording ? t("meeting.stopRecord") : t("meeting.record")}
          icon={
            recording ? (
              <StopOutlined style={ICON_STYLE} aria-hidden />
            ) : (
              <PlayCircleOutlined style={ICON_STYLE} aria-hidden />
            )
          }
          className={recording ? "is-recording" : ""}
          onClick={onToggleRecord}
          disabled={!canRecord}
          ariaLabel={recording ? t("meeting.stopRecord") : t("meeting.record")}
          ariaPressed={recording}
        />
        <ControlButton
          label={t("meeting.members")}
          icon={<TeamOutlined style={ICON_STYLE} aria-hidden />}
          className={membersOpen ? "is-active" : ""}
          onClick={onToggleMembers}
          ariaPressed={membersOpen}
        />
        <ControlButton
          label={t("meeting.chat")}
          icon={<MessageOutlined style={ICON_STYLE} aria-hidden />}
          className={chatOpen ? "is-active" : ""}
          onClick={onToggleChat}
          ariaPressed={chatOpen}
          badge={chatOpen ? 0 : unreadChat}
        />
        <ControlButton
          label={t("meeting.handShort")}
          icon={<AlertOutlined style={ICON_STYLE} aria-hidden />}
          className={handRaised ? "is-active" : ""}
          onClick={onToggleHand}
          ariaLabel={handRaised ? t("meeting.handDown") : t("meeting.hand")}
          ariaPressed={handRaised}
        />
      </div>

      <div className="controls-leave">
        {isHost ? (
          <ControlButton
            label={t("meeting.endShort")}
            icon={<PoweroffOutlined style={ICON_STYLE} aria-hidden />}
            className="control-btn--danger-text"
            onClick={() => {
              modal.confirm({
                title: t("meeting.confirmEnd"),
                okText: t("common.confirm"),
                cancelText: t("common.cancel"),
                okButtonProps: { danger: true },
                onOk: () => {
                  onEndMeeting();
                },
              });
            }}
            ariaLabel={t("meeting.end")}
          />
        ) : (
          <ControlButton
            label={t("meeting.leave")}
            icon={<LogoutOutlined style={ICON_STYLE} aria-hidden />}
            className="control-btn--danger-text"
            onClick={() => {
              modal.confirm({
                title: t("meeting.confirmLeave"),
                okText: t("common.confirm"),
                cancelText: t("common.cancel"),
                okButtonProps: { danger: true },
                onOk: () => {
                  onLeave();
                },
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
