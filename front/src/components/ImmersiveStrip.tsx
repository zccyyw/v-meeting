import { useTranslation } from "react-i18next";
import { DesktopOutlined } from "@ant-design/icons";
import { DraggableSideList, type Tile } from "@/components/VideoGrid";

/**
 * 沉浸模式小窗（方案 2）：共享全屏时使用。
 * 仅渲染摄像头画面（本地 + 远端），**不含共享流** —— 因此不会产生画面嵌套。
 * 小窗可拖动：拖到非共享的屏幕（如扩展屏）即可避免它被共享给参会者。
 */
export function ImmersiveStrip({
  tiles,
  sharingLabel,
  onExit,
}: {
  tiles: Tile[];
  sharingLabel: string;
  onExit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="immersive-strip">
      <div className="immersive-bar">
        <span className="immersive-bar-status">
          <DesktopOutlined aria-hidden />
          {sharingLabel}
        </span>
        <span className="immersive-bar-hint">{t("meeting.immersiveHint")}</span>
        <button
          type="button"
          className="immersive-bar-exit"
          onClick={onExit}
        >
          {t("meeting.exitImmersive")}
        </button>
      </div>
      <DraggableSideList tiles={tiles} isTraining={false} handTitle={t("meeting.hand")} />
    </div>
  );
}
