import { useEffect } from "react";
import { API_BASE } from "@/api/client";
import { getSessionId } from "@/auth/session";

type Listener = () => void;

// 模块级单例：同一标签页内多个订阅者共用一条 SSE 连接。
const listeners = new Set<Listener>();
let source: EventSource | null = null;

function ensureConnection(): void {
  if (source || typeof EventSource === "undefined") return;
  const sid = getSessionId();
  if (!sid) return;
  source = new EventSource(
    `${API_BASE}/meetings/my-invitations/stream?sid=${encodeURIComponent(sid)}`,
  );
  // 断线由 EventSource 自动重连；仅在无订阅者时主动关闭。
  source.onmessage = () => {
    for (const listener of [...listeners]) listener();
  };
}

function releaseIfIdle(): void {
  if (listeners.size === 0 && source) {
    source.close();
    source = null;
  }
}

/**
 * 订阅“待加入会议变化”（群组一键开会 / 被点名邀请）的实时推送。
 * 多组件（左侧铃铛、首页右栏日程）共享同一条 SSE，避免重复连接。
 */
export function useInvitationsStream(onChange: () => void): void {
  useEffect(() => {
    listeners.add(onChange);
    ensureConnection();
    return () => {
      listeners.delete(onChange);
      releaseIfIdle();
    };
  }, [onChange]);
}
