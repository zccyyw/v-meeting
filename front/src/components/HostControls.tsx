import { useTranslation } from "react-i18next";
import { App } from "antd";
import {
  CloseOutlined,
  AlertOutlined,
  AudioOutlined,
  AudioMutedOutlined,
  CheckCircleFilled,
  MinusCircleFilled,
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
  isSelf: boolean;
  handRaised: boolean;
  /** 邀请状态 */
  inviteStatus?: string;
};

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
  const onlineNames = new Set<string>();

  // 已上线成员（先自己，再其他人）
  for (const p of peers) {
    const isSelf = p.peerId === selfPeerId;
    onlineNames.add(p.displayName);
    onlineMembers.push({
      key: p.peerId,
      displayName: p.displayName,
      online: true,
      peerId: p.peerId,
      micEnabled: p.micEnabled,
      isSelf,
      handRaised: p.handRaised,
    });
  }

  // 未上线的被邀请者
  const offlineMembers: MemberRow[] = [];
  for (const inv of invitations) {
    if (onlineNames.has(inv.displayName)) continue; // 已上线，跳过
    const isAttended = inv.status === "attended";
    offlineMembers.push({
      key: `inv-${inv.id}`,
      displayName: inv.displayName,
      online: false,
      micEnabled: false,
      isSelf: false,
      handRaised: false,
      inviteStatus: isAttended
        ? t("meeting.inviteStatusAttended", "已入会")
        : t("meeting.inviteStatusPending", "待入会"),
    });
  }

  // 合并：已上线在前，未上线在后
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
                <span className="member-row-left">
                  {/* 在线状态图标 */}
                  {m.online ? (
                    <CheckCircleFilled
                      className="member-online-icon"
                      style={{ color: "#52c41a", marginRight: 6 }}
                      aria-label={t("meeting.inviteStatusInRoom", "在会议中")}
                    />
                  ) : (
                    <MinusCircleFilled
                      className="member-offline-icon"
                      style={{ color: "#bfbfbf", marginRight: 6 }}
                      aria-label={m.inviteStatus || t("meeting.inviteStatusPending", "待入会")}
                    />
                  )}
                  <span className="member-name">{m.displayName}</span>
                  {m.isSelf && (
                    <span className="member-self-tag" style={{ color: "#8c8c8c", fontSize: "0.75rem" }}>
                      ({t("meeting.me")})
                    </span>
                  )}
                  {m.handRaised && (
                    <AlertOutlined style={{ marginLeft: 4, color: "#faad14" }} aria-hidden />
                  )}
                  {/* 麦克风状态 */}
                  {m.online && !m.isSelf && (
                    m.micEnabled ? (
                      <AudioOutlined style={{ marginLeft: 4, fontSize: 14, color: "#52c41a" }} aria-label={t("meeting.mic")} />
                    ) : (
                      <AudioMutedOutlined style={{ marginLeft: 4, fontSize: 14, color: "#ff4d4f" }} aria-label={t("meeting.mute")} />
                    )
                  )}
                  {!m.online && m.inviteStatus && (
                    <span className="member-invite-status" style={{ color: "#8c8c8c", fontSize: "0.72rem", marginLeft: 4 }}>
                      {m.inviteStatus}
                    </span>
                  )}
                </span>
                {/* 主持人操作按钮 */}
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
