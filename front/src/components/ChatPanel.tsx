import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { CloseOutlined } from "@ant-design/icons";
import type { ChatMessage } from "@/media/room";

type Props = {
  messages: ChatMessage[];
  selfPeerId: string | null;
  onSend: (text: string) => void;
  onClose: () => void;
};

function initialOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toUpperCase();
}

function formatTime(at: string): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ChatPanel({ messages, selfPeerId, onSend, onClose }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onSend(value);
    setText("");
  }

  return (
    <section className="side-panel chat-panel" aria-label={t("meeting.chatTitle")}>
      <header className="side-panel-header">
        <h2>{t("meeting.chatTitle")}</h2>
        <button
          type="button"
          className="side-panel-close"
          onClick={onClose}
          aria-label={t("meeting.closePanel")}
        >
          <CloseOutlined aria-hidden />
        </button>
      </header>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="muted">{t("meeting.chatEmpty")}</p>
        )}
        {messages.map((m, i) => {
          const isSelf = selfPeerId != null && m.peerId === selfPeerId;
          return (
            <div
              key={`${m.at}-${m.peerId}-${i}`}
              className={`chat-item${isSelf ? " chat-item--self" : " chat-item--other"}`}
            >
              <span className="chat-avatar" aria-hidden>
                {initialOf(m.displayName)}
              </span>
              <div className="chat-bubble-wrap">
                <div className="chat-bubble-meta">
                  <strong>{m.displayName}</strong>
                  <time dateTime={m.at}>{formatTime(m.at)}</time>
                </div>
                <p className="chat-text">{m.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      <form className="chat-form" onSubmit={submit}>
        <input
          type="text"
          value={text}
          maxLength={2000}
          placeholder={t("meeting.chatPlaceholder")}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" disabled={!text.trim()}>
          {t("meeting.chatSend")}
        </button>
      </form>
    </section>
  );
}
