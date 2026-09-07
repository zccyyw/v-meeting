import { useTranslation } from "react-i18next";
import { App } from "antd";
import {
  CloseOutlined,
  AlertOutlined,
  AudioOutlined,
  AudioMutedOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type { PeerInfo } from "@/media/room";
import type { InvitationItem } from "@/api/client";

type Props = {
  isHost: boolean;
  allowShare: boolean;
  allMuted: boolean;
  peers: PeerInfo[];
  selfPeerId: string | null;
  invitations: InvitationItem[];
  onClose: () => void;
  onToggleAllowShare: () => void;
  onToggleMuteAll: () => void;
  onMutePeer: (peerId: string) => void;
  onKick: (peerId: string) => void;
};

/** 成员行项：合并邀请名单和在线 peer */
type MemberRow = {
  key: string;
  displayName: string;
  /** 是否在线（在 peers 列表中） */
  online: boolean;
  /** 在线时的 peerId（用于静音/踢出） */
  peerId?: string;
  micEnabled: boolean;
  camEnabled: boolean;
  isSelf: boolean;
  handRaised: boolean;
};

/** 从显示名生成头像首字母 */
function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2).toUpperCase();
}

export function HostControls({
  isHost,
  allowShare,
  allMuted,
  peers,
  selfPeerId,
  invitations,
  onClose,
  onToggleAllowShare,
  onToggleMuteAll,
  onMutePeer,
  onKick,
}: Props) {
  const { t } = useTranslation();
  const { modal } = App.useApp();

  // 构建合并后的成员列表
  // 1. 先从 peers 中收集已上线成员
  // 2. 再从 invitations 中补充未上线的被邀请者
  // 3. 已上线排最上面
  const onlineMembers: MemberRow[] = [];
  const onlineNamesLower = new Set<string>();

  for (const p of peers) {
    const isSelf = p.peerId === selfPeerId;
    onlineNamesLower.add(p.displayName.trim().toLowerCase());
    onlineMembers.push({
      key: p.peerId,
      displayName: p.displayName,
      online: true,
      peerId: p.peerId,
      micEnabled: p.micEnabled,
      camEnabled: p.camEnabled,
      isSelf,
      handRaised: p.handRaised,
    });
  }

  const offlineMembers: MemberRow[] = [];
  for (const inv of invitations) {
    // 大小写不敏感 + trim 匹配
    if (onlineNamesLower.has(inv.displayName.trim().toLowerCase())) continue;
    offlineMembers.push({
      key: `inv-${inv.id}`,
      displayName: inv.displayName,
      online: false,
      micEnabled: false,
      camEnabled: false,
      isSelf: false,
      handRaised: false,
    });
  }

  const allMembers = [...onlineMembers, ...offlineMembers];

  return (
    <section className="side-panel host-controls" aria-label={t("meeting.members")}>
      <header className="side-panel-header">
        <h2>{t("meeting.members")}</h2>
        <button
          type="button"
          className="side-panel-close"
          onClick={onClose}
          aria-label={t("meeting.closePanel")}
        >
          <CloseOutlined aria-hidden />
        </button>
      </header>

      {isHost && (
        <div className="host-actions">
          <button type="button" onClick={onToggleMuteAll}>
            {allMuted ? t("meeting.unmuteAll") : t("meeting.muteAll")}
          </button>
          <button type="button" onClick={onToggleAllowShare}>
            {allowShare ? t("meeting.denyShare") : t("meeting.allowShare")}
          </button>
        </div>
      )}

      {allMembers.length === 0 ? (
        <p className="muted">{t("meeting.noMembers")}</p>
      ) : (
        <div className="host-peer-list">
          <ul className="waiting-list member-unified-list">
            {allMembers.map((m) => (
              <li key={m.key} className="member-row">
                {/* 左侧：头像 + 状态小点 */}
                <div className="member-avatar-wrap">
                  <div
                    className={`member-avatar${m.online ? "" : " is-offline"}`}
                    aria-hidden
                  >
                    {getInitials(m.displayName)}
                  </div>
                  {/* 仿 QQ 状态小点：在线绿色，离线灰色 */}
                  <span
                    className={`member-status-dot${m.online ? " online" : " offline"}`}
                    aria-label={m.online ? t("meeting.inviteStatusInRoom", "在会议中") : t("meeting.inviteStatusPending", "待入会")}
                  />
                </div>

                {/* 中间：名称 + 麦克风/摄像头图标 */}
                <div className="member-info">
                  <div className="member-name-row">
                    <span className="member-name">{m.displayName}</span>
                    {m.isSelf && (
                      <span className="member-self-tag">({t("meeting.me")})</span>
                    )}
                    {m.handRaised && (
                      <AlertOutlined style={{ marginLeft: 4, color: "#faad14", fontSize: 13 }} aria-hidden />
                    )}
                  </div>
                  {/* 麦克风/摄像头状态图标 */}
                  {m.online && (
                    <div className="member-media-icons">
                      <span className={`member-media-icon ${m.micEnabled ? "on" : "off"}`}>
                        {m.micEnabled ? <AudioOutlined /> : <AudioMutedOutlined />}
                      </span>
                      <span className={`member-media-icon ${m.camEnabled ? "on" : "off"}`}>
                        <VideoCameraOutlined />
                      </span>
                    </div>
                  )}
                </div>

                {/* 右侧：主持人操作按钮 */}
                {isHost && m.online && !m.isSelf && m.peerId && (
                  <div className="waiting-actions member-actions">
                    <button
                      type="button"
                      className="ghost member-mute-btn"
                      onClick={() => onMutePeer(m.peerId!)}
                      disabled={!m.micEnabled}
                      aria-label={t("meeting.mute")}
                      title={t("meeting.mute")}
                    >
                      {m.micEnabled ? <AudioOutlined /> : <AudioMutedOutlined />}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        modal.confirm({
                          title: t("meeting.confirmKick", { name: m.displayName }),
                          okText: t("common.confirm"),
                          cancelText: t("common.cancel"),
                          okButtonProps: { danger: true },
                          onOk: () => {
                            onKick(m.peerId!);
                          },
                        });
                      }}
                    >
                      {t("meeting.kick")}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
