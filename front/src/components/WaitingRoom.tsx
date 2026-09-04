import { useTranslation } from "react-i18next";
import type { WaitingPeer } from "@/media/room";

type Props = {
  /** True when this client is waiting for host admit. */
  selfWaiting: boolean;
  isHost: boolean;
  waitingPeers: WaitingPeer[];
  onAdmit: (peerId: string) => void;
  onDeny: (peerId: string) => void;
};

export function WaitingRoom({
  selfWaiting,
  isHost,
  waitingPeers,
  onAdmit,
  onDeny,
}: Props) {
  const { t } = useTranslation();

  if (selfWaiting) {
    return (
      <section className="panel waiting-room">
        <h2>{t("meeting.waitingTitle")}</h2>
        <p className="muted">{t("meeting.waitingHint")}</p>
      </section>
    );
  }

  if (!isHost || waitingPeers.length === 0) {
    return null;
  }

  return (
    <section className="panel waiting-room">
      <h2>{t("meeting.pendingAdmit", { count: waitingPeers.length })}</h2>
      <ul className="waiting-list">
        {waitingPeers.map((p) => (
          <li key={p.peerId}>
            <span>{p.displayName}</span>
            <span className="waiting-actions">
              <button type="button" onClick={() => onAdmit(p.peerId)}>
                {t("meeting.admit")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => onDeny(p.peerId)}
              >
                {t("meeting.deny")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
