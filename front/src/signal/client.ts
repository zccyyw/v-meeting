import type { ClientMessage, ServerMessage } from "@meeting/shared";

function resolveWsUrl(): string {
  const env = (import.meta.env.VITE_WS_URL as string | undefined)?.trim();
  if (env && env !== "auto") {
    if (env.startsWith("/") && typeof window !== "undefined") {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${window.location.host}${env}`;
    }
    if (env.startsWith("ws://") || env.startsWith("wss://")) return env;
  }
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }
  return "ws://127.0.0.1:8082";
}

const WS_URL = resolveWsUrl();

/** 应用层心跳间隔（服务端收到 ping 立即回 pong） */
const HEARTBEAT_INTERVAL_MS = 20_000;
/**
 * 超过该时长未收到任何服务端消息即判定为"半开连接"（TCP 未断但对端已无响应）。
 * 浏览器无法观测 WS 级 ping/pong，只能靠应用层心跳自检 —— 否则 WiFi 切换、
 * 代理掉线等场景下前端会长时间停留在旧画面，服务端最坏也要 ~60s 才 terminate。
 */
const HEARTBEAT_TIMEOUT_MS = 45_000;

export type MessageHandler = (msg: ServerMessage) => void;
/** 非主动 close() 导致的连接断开回调（供上层实现自动重连） */
export type UnexpectedCloseHandler = () => void;

export class SignalClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  /** 标记是否为主动关闭，防止 onerror 误报 */
  private closed = false;
  private onUnexpectedClose: UnexpectedCloseHandler | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  /** 最近一次收到服务端消息的时间（心跳自检用） */
  private lastActivityAt = 0;

  /** 注册“意外断开”回调（同一时刻只保留一个消费者）。 */
  setUnexpectedCloseHandler(handler: UnexpectedCloseHandler): void {
    this.onUnexpectedClose = handler;
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.lastActivityAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - this.lastActivityAt > HEARTBEAT_TIMEOUT_MS) {
        // 半开连接：主动断开，交由上层 onUnexpectedClose 触发重连
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        return;
      }
      const ping: ClientMessage = { type: "ping" };
      try {
        ws.send(JSON.stringify(ping));
      } catch {
        /* ignore */
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        const ws = this.ws!;
        const onOpen = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          if (this.closed) resolve();
          else reject(new Error("ws_connect_failed"));
        };
        const cleanup = () => {
          ws.removeEventListener("open", onOpen);
          ws.removeEventListener("error", onError);
        };
        ws.addEventListener("open", onOpen);
        ws.addEventListener("error", onError);
      });
    }

    this.closed = false;
    return new Promise((resolve, reject) => {
      // 用微任务延迟 WS 创建，使 React StrictMode 的同步 mount→unmount→remount
      // 有机会在 WS 实际创建前调用 close() 取消连接，避免浏览器报
      // "WebSocket is closed before the connection is established"
      queueMicrotask(() => {
        if (this.closed) {
          // React StrictMode 双挂载：第一次 mount 被 cleanup 后 close() 已调用。
          // 不 resolve 也不 reject — Promise 保持 pending，join() 的 await
          // 挂起但不会到达 send()。cleanup 中 room.leave() 的 signal.send()
          // 有 try/catch 保护，SignalClient 实例将被 GC 回收。
          return;
        }
        const ws = new WebSocket(WS_URL);
        this.ws = ws;
        // 连接超时保护：TCP/握手被网络黑洞拖住时主动断开，供上层重试
        const connectTimer = setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        }, 12_000);
        ws.onopen = () => {
          clearTimeout(connectTimer);
          this.startHeartbeat(ws);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(connectTimer);
          if (this.closed) resolve();
          else reject(new Error("ws_connect_failed"));
        };
        ws.onmessage = (ev) => {
          this.lastActivityAt = Date.now();
          try {
            const msg = JSON.parse(String(ev.data)) as ServerMessage;
            for (const h of [...this.handlers]) h(msg);
          } catch {
            /* ignore malformed */
          }
        };
        ws.onclose = () => {
          clearTimeout(connectTimer);
          this.stopHeartbeat();
          if (this.ws === ws) this.ws = null;
          // 非主动关闭：通知上层（自动重连）
          if (!this.closed) this.onUnexpectedClose?.();
        };
      });
    });
  }

  send(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("ws_not_connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  close(): void {
    this.closed = true;
    this.stopHeartbeat();
    const ws = this.ws;
    this.ws = null;
    this.handlers.clear();
    if (ws && ws.readyState <= WebSocket.OPEN) {
      // 清除所有事件回调，防止 ws.close() 在 CONNECTING 状态时
      // 同步触发 onerror 导致未捕获的 Promise rejection
      ws.onopen = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.close();
    }
  }
}
