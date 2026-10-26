import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { App, ConfigProvider, Dropdown, type MenuProps } from "antd";
import {
  AudioOutlined,
  SoundOutlined,
  AudioMutedOutlined,
  VideoCameraOutlined,
  DesktopOutlined,
  UserAddOutlined,
  TeamOutlined,
  MessageOutlined,
  LogoutOutlined,
  PoweroffOutlined,
  PlayCircleOutlined,
  StopOutlined,
  CaretUpFilled,
  CheckOutlined,
} from "@ant-design/icons";
import { HandIcon } from "@/components/HandIcon";
import { MEETING_DARK_OVERLAY_THEME } from "@/theme/meetingOverlayTheme";

const ICON_STYLE = { fontSize: 22 } as const;
const CARET_STYLE = { fontSize: 10 } as const;

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
  /** 允许共享屏幕（房间级）：仅 host 的共享菜单可见，成员被禁时禁标+提示 */
  allowShare: boolean;
  /** 允许成员录制（房间级）：仅 host 的录制菜单可见 */
  recordAllowed: boolean;
  /** 麦克风被禁（全体禁言/禁止自我解除静音）：成员端禁标 + 点击提示 */
  micBanned?: boolean;
  micBannedTip?: string;
  /** 麦克风/摄像头设备枚举与当前选中（设备菜单数据源） */
  audioInputs: MediaDeviceInfo[];
  videoInputs: MediaDeviceInfo[];
  audioId: string;
  videoId: string;
  /** 麦克风/摄像头设备浮窗打开时触发——重新枚举设备列表（部分驱动插拔不触发 devicechange）。
   *  传入对应类型时先做权限预触发（未授权时枚举不出新插设备）。 */
  onRefreshDevices?: (kind?: "audio" | "video") => void;
  onChangeAudio: (deviceId: string) => void;
  onChangeVideo: (deviceId: string) => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleHand: () => void;
  handDisabled?: boolean;
  onToggleScreenShare: () => void;
  onToggleAllowShare: () => void;
  onToggleRecordAllowed: () => void;
  /** 存在共享内容声音（任一成员在共享且带音频）时显示该开关 */
  screenAudioAvailable?: boolean;
  screenAudioMuted?: boolean;
  onToggleScreenAudio?: () => void;
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
  banned,
  bannedTip,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  badge?: number;
  /** 主持人禁用（共享/录制/发言）：icon 右下角红色禁止标 + hover 提示，点击仍走提示路径 */
  banned?: boolean;
  bannedTip?: string;
}) {
  const tip = banned && bannedTip ? bannedTip : (ariaLabel ?? label);
  return (
    <button
      type="button"
      className={`control-btn ${className}`.trim()}
      onClick={onClick}
      disabled={disabled}
      aria-label={tip}
      aria-disabled={banned || undefined}
      title={tip}
      aria-pressed={ariaPressed}
    >
      <span className="control-btn-icon">
        {icon}
        {badge != null && badge > 0 && (
          <span className="control-btn-badge" aria-hidden>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
        {banned && <span className="control-ban" aria-hidden />}
      </span>
      <span className="control-btn-label">{label}</span>
    </button>
  );
}

/**
 * 两段式控制按钮（对齐腾讯会议）：主区（图标+文字，执行主操作）+ caret（展开
 * 设备/选项菜单）。caret 属可选——无菜单内容的按钮不渲染。
 */
function ControlSplitButton({
  label,
  icon,
  onClick,
  className = "",
  disabled,
  ariaLabel,
  ariaPressed,
  hostLocked,
  hostLockedTip,
  menuItems,
  onMenuClick,
  onOpenChange,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  hostLocked?: boolean;
  hostLockedTip?: string;
  menuItems?: MenuProps["items"];
  onMenuClick?: (key: string) => void;
  /** 下拉浮窗打开状态变化——设备列表在 open=true 时触发重新枚举 */
  onOpenChange?: (open: boolean) => void;
}) {
  const main = (
    <ControlButton
      label={label}
      icon={icon}
      onClick={onClick}
      className={className}
      disabled={disabled}
      ariaLabel={ariaLabel}
      ariaPressed={ariaPressed}
      banned={hostLocked}
      bannedTip={hostLockedTip}
    />
  );
  if (!menuItems) return main;
  return (
    <div className="control-split">
      {main}
      <ConfigProvider theme={MEETING_DARK_OVERLAY_THEME}>
        <Dropdown
          trigger={["click"]}
          placement="topRight"
          rootClassName="meeting-dark-menu"
          // 每次打开设备浮窗时重新枚举（open 变化回调）：
          // 部分驱动插拔不触发 mediaDevices 的 devicechange 事件，
          // 仅依赖事件会导致"先入会后插摄像头"时设备列表陈旧
          onOpenChange={(open) => onOpenChange?.(open)}
          menu={{
            items: menuItems,
            onClick: ({ key }) => onMenuClick?.(key),
          }}
        >
          <button
            type="button"
            className="control-split-caret"
            aria-label={`${label} options`}
            title={`${label} options`}
          >
            <CaretUpFilled style={CARET_STYLE} aria-hidden />
          </button>
        </Dropdown>
      </ConfigProvider>
    </div>
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
  recording,
  canRecord,
  allowShare,
  recordAllowed,
  micBanned = false,
  micBannedTip,
  audioInputs,
  videoInputs,
  audioId,
  videoId,
  onRefreshDevices,
  onChangeAudio,
  onChangeVideo,
  onToggleMic,
  onToggleCam,
  onToggleHand,
  handDisabled = false,
  onToggleScreenShare,
  onToggleAllowShare,
  onToggleRecordAllowed,
  screenAudioAvailable,
  screenAudioMuted,
  onToggleScreenAudio,
  onToggleMembers,
  onToggleChat,
  onInvite,
  onLeave,
  onEndMeeting,
  onToggleRecord,
}: Props) {
  const { t } = useTranslation();
  const { modal } = App.useApp();

  const deviceLabel = (d: MediaDeviceInfo) =>
    d.label || d.deviceId.slice(0, 6);
  /** 菜单选项行：文字居左，选中 ✓ 居右（对齐腾讯会议样式） */
  const menuRow = (text: string, selected: boolean): ReactNode => (
    <span className="menu-row">
      <span className="menu-row-text">{text}</span>
      {selected && <CheckOutlined aria-hidden />}
    </span>
  );

  return (
    <div className="controls" role="toolbar" aria-label={t("meeting.title")}>
      <div className="controls-cluster">
        <ControlSplitButton
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
          hostLocked={micBanned && !micEnabled}
          hostLockedTip={micBannedTip}
          menuItems={[
            {
              key: "g-mic",
              type: "group",
              label: t("meeting.mic"),
              children:
                audioInputs.length > 0
                  ? audioInputs.map((d) => ({
                      key: d.deviceId,
                      label: menuRow(deviceLabel(d), d.deviceId === audioId),
                    }))
                  : [
                      {
                        key: "no-audio-devices",
                        label: t("meeting.noMicDevices"),
                        disabled: true,
                      },
                    ],
            },
          ]}
          onMenuClick={(key) => onChangeAudio(key)}
          onOpenChange={(open) => {
            if (open) onRefreshDevices?.("audio");
          }}
        />
        <ControlSplitButton
          label={t("meeting.camera")}
          icon={
            camEnabled ? (
              <VideoCameraOutlined style={ICON_STYLE} aria-hidden />
            ) : (
              <span className="icon-slashed" aria-hidden>
                <VideoCameraOutlined style={ICON_STYLE} />
              </span>
            )
          }
          className={camEnabled ? "" : "is-off"}
          onClick={onToggleCam}
          ariaLabel={camEnabled ? t("meeting.camOff") : t("meeting.camOn")}
          ariaPressed={!camEnabled}
          menuItems={[
            {
              key: "g-cam",
              type: "group",
              label: t("meeting.camera"),
              children:
                videoInputs.length > 0
                  ? videoInputs.map((d) => ({
                      key: d.deviceId,
                      label: menuRow(deviceLabel(d), d.deviceId === videoId),
                    }))
                  : [
                      {
                        key: "no-video-devices",
                        label: t("meeting.noCameraDevices"),
                        disabled: true,
                      },
                    ],
            },
          ]}
          onMenuClick={(key) => onChangeVideo(key)}
          onOpenChange={(open) => {
            if (open) onRefreshDevices?.("video");
          }}
        />
        <ControlSplitButton
          label={t("meeting.shareShort")}
          icon={<DesktopOutlined style={ICON_STYLE} aria-hidden />}
          className={sharingScreen ? "is-active" : ""}
          onClick={onToggleScreenShare}
          ariaLabel={sharingScreen ? t("meeting.stopShare") : t("meeting.share")}
          ariaPressed={sharingScreen}
          hostLocked={!sharingScreen && !canShare}
          hostLockedTip={t("meeting.shareDisabledByHost")}
          menuItems={
            isHost
              ? [
                  {
                    key: "allowShare",
                    label: menuRow(t("meeting.toolAllowShare"), allowShare),
                  },
                ]
              : undefined
          }
          onMenuClick={() => onToggleAllowShare()}
        />
        <ControlButton
          label={t("meeting.invite")}
          icon={<UserAddOutlined style={ICON_STYLE} aria-hidden />}
          onClick={onInvite}
        />
        {screenAudioAvailable && onToggleScreenAudio && (
          <ControlButton
            label={t("meeting.screenAudio")}
            icon={
              screenAudioMuted ? (
                <span className="icon-slashed" aria-hidden>
                  <SoundOutlined style={ICON_STYLE} />
                </span>
              ) : (
                <SoundOutlined style={ICON_STYLE} aria-hidden />
              )
            }
            className={screenAudioMuted ? "is-off" : "is-active"}
            onClick={onToggleScreenAudio}
            ariaLabel={screenAudioMuted ? t("meeting.screenAudioOff") : t("meeting.screenAudioOn")}
            ariaPressed={!screenAudioMuted}
          />
        )}
        <ControlSplitButton
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
          ariaLabel={recording ? t("meeting.stopRecord") : t("meeting.record")}
          ariaPressed={recording}
          hostLocked={!recording && !canRecord}
          hostLockedTip={t("meeting.recordDisabledByHost")}
          menuItems={
            isHost
              ? [
                  {
                    key: "g-perm",
                    type: "group",
                    label: t("meeting.recordPermission"),
                    children: [
                      {
                        key: "host-only",
                        label: menuRow(t("meeting.recordHostOnly"), !recordAllowed),
                      },
                      {
                        key: "all",
                        label: menuRow(t("meeting.recordAllMembers"), recordAllowed),
                      },
                    ],
                  },
                ]
              : undefined
          }
          onMenuClick={(key) => {
            const next = key === "all";
            if (next !== recordAllowed) onToggleRecordAllowed();
          }}
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

          disabled={handDisabled}
          icon={<HandIcon style={ICON_STYLE} />}
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
