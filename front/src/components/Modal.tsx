import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CloseOutlined } from "@ant-design/icons";

type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** dark: in-meeting invite etc. */
  tone?: "light" | "dark";
  /** CSS max-width value for the modal dialog. */
  width?: string;
  /** Extra class on the dialog panel (e.g. preview layout). */
  className?: string;
};

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  tone = "light",
  width,
  className,
}: ModalProps) {
  const { t } = useTranslation();
  if (!open) return null;

  const style = width ? { maxWidth: width } : undefined;
  const panelClass = [
    "modal",
    tone === "dark" ? "modal--dark" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={`modal-backdrop${tone === "dark" ? " modal-backdrop--dark" : ""}`}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={panelClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        style={style}
      >
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <CloseOutlined aria-hidden />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer != null && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}
