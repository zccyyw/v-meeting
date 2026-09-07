import { useTranslation } from "react-i18next";
import type { InvitationItem } from "@/api/client";

type PeerInfo = { peerId: string; displayName: string };

export function InvitationPanel({
  invitations,
  peers,
  floating = false,
  onClose,
}: {
  invitations: InvitationItem[];
  peers: PeerInfo[];
  floating?: boolean;
  onClose?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={`invite-panel${floating ? " invite-panel-floating" : ""}`}>
      <div className="invite-panel-header">
        <h3>{t("meeting.inviteList", "邀请名单")}</h3>
        {onClose && (
          <button
            type="button"
            className="invite-panel-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>
      <div className="invite-panel-body">
        {invitations.length === 0 ? (
          <p className="muted">{t("meeting.noInvitations", "暂无邀请记录")}</p>
        ) : (
          <ul className="invite-list">
            {invitations.map((inv) => {
              const isOnline = inv.status === "attended";
              const inRoom = peers.some((p) => p.displayName === inv.displayName);
              return (
                <li key={inv.id} className="invite-list-item">
                  <span
                    className={`invite-status-dot ${
                      inRoom ? "online" : isOnline ? "online" : "offline"
                    }`}
                    aria-hidden
                  />
                  <span className="invite-list-name">
                    {inv.displayName}
                    {inv.deptName ? (
                      <span className="invite-list-dept">{inv.deptName}</span>
                    ) : null}
                  </span>
                  <span className="invite-list-status">
                    {inRoom
                      ? t("meeting.inviteStatusInRoom", "在会议中")
                      : isOnline
                        ? t("meeting.inviteStatusAttended", "已入会")
                        : t("meeting.inviteStatusPending", "待入会")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
