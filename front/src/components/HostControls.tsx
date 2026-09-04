import { useTranslation } from "react-i18next";
import { App } from "antd";
import { CloseOutlined, AlertOutlined } from "@ant-design/icons";
import type { PeerInfo } from "@/media/room";

type Props = {
  isHost: boolean;
  allowShare: boolean;
  allMuted: boolean;
  peers: PeerInfo[];
  selfPeerId: string | null;
  onClose: () => void;
  onToggleAllowShare: () => void;
  onToggleMuteAll: () => void;
  onKick: (peerId: string) => void;
};

export function HostControls({
  isHost,
  allowShare,
  allMuted,
  peers,
  selfPeerId,
  onClose,
  onToggleAllowShare,
  onToggleMuteAll,
  onKick,
}: Props) {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const others = peers.filter((p) => p.peerId !== selfPeerId);

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

      {others.length === 0 ? (
        <p className="muted">{t("meeting.noMembers")}</p>
      ) : (
        <div className="host-peer-list">
          <ul className="waiting-list">
            {others.map((p) => (
              <li key={p.peerId}>
                <span>
                  {p.displayName}
                  {p.handRaised ? <AlertOutlined style={{ marginLeft: 4, color: "#faad14" }} aria-hidden /> : null}
                </span>
                {isHost && (
                  <div className="waiting-actions">
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => {
                        modal.confirm({
                          title: t("meeting.confirmKick", { name: p.displayName }),
                          okText: t("common.confirm"),
                          cancelText: t("common.cancel"),
                          okButtonProps: { danger: true },
                          onOk: () => {
                            onKick(p.peerId);
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
