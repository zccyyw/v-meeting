import { EventEmitter } from "node:events";
import type { Redis } from "ioredis";

/**
 * “按用户”站内通知中枢，用于待加入会议的实时推送（SSE）。
 *
 * 自适应策略：
 * - Redis 可用（ioredis）：走 pub/sub，支持多实例水平扩展——任一实例
 *   `notifyUser` 后，所有实例的订阅都会收到并就近投递给本地 SSE 连接。
 * - Redis 不可用（默认 MemoryRedis 单机模式）：退化为进程内 EventEmitter。
 *
 * 去重说明：pub/sub 模式下不本地直发，仅 publish；本实例由订阅回调投递，
 * 从而保证“每个实例恰好投递一次”，避免发布端重复触发。
 */
const NOTIFY_CHANNEL = "meeting:notify";

const emitter = new EventEmitter();
// 单机可能同时保持较多 SSE 监听，取消默认 10 个的告警上限。
emitter.setMaxListeners(0);

let pubClient: Redis | null = null;
let subClient: Redis | null = null;

export type UserNotice = {
  /** 事件类型，前端可据此决定是否刷新列表 */
  type: "invitations_changed";
  /** 触发的会议 id（可选） */
  meetingId?: number;
};

/** 是否为支持 pub/sub 的真 ioredis（MemoryRedis 无 duplicate()）。 */
function canPubSub(redis: Redis): boolean {
  return (
    typeof (redis as unknown as { duplicate?: unknown }).duplicate === "function"
  );
}

function emitLocal(userId: number, notice: UserNotice): void {
  emitter.emit(`user:${userId}`, notice);
}

/**
 * 初始化通知。应在服务启动时调用一次（见 index.ts）。
 * Redis 可用时建立订阅连接；失败则回退为进程内模式（不影响主流程）。
 */
export function initNotify(redis: Redis): void {
  if (!canPubSub(redis)) return; // 单机内存模式：仅进程内事件

  const sub = redis.duplicate();
  sub.on("message", (_channel: string, message: string) => {
    try {
      const parsed = JSON.parse(message) as {
        userId: number;
        notice: UserNotice;
      };
      emitLocal(Number(parsed.userId), parsed.notice);
    } catch {
      /* 忽略坏消息 */
    }
  });

  // 订阅成功后再启用 publish，确保本实例发布的消息也由自身订阅收回，
  // 从而避免“已 publish 但尚未 subscribe”窗口内的本地丢失。
  sub
    .subscribe(NOTIFY_CHANNEL)
    .then(() => {
      subClient = sub;
      pubClient = redis;
    })
    .catch((err: unknown) => {
      console.error("[notify] subscribe failed, fallback to in-process mode", err);
      try {
        sub.disconnect();
      } catch {
        /* ignore */
      }
    });
}

/**
 * 通知某个用户。
 * - pub/sub 模式：仅发布，由各实例的订阅回调投递（含本实例）。
 * - 进程内模式：直接本地投递。
 */
export function notifyUser(userId: number, notice: UserNotice): void {
  if (pubClient) {
    void pubClient
      .publish(NOTIFY_CHANNEL, JSON.stringify({ userId, notice }))
      .catch(() => emitLocal(userId, notice));
    return;
  }
  emitLocal(userId, notice);
}

/** 订阅某个用户的通知，返回取消订阅函数。 */
export function subscribeUser(
  userId: number,
  listener: (notice: UserNotice) => void,
): () => void {
  const key = `user:${userId}`;
  emitter.on(key, listener);
  return () => emitter.off(key, listener);
}

/** 关闭订阅连接（优雅停机时调用）。 */
export async function closeNotify(): Promise<void> {
  const sub = subClient;
  subClient = null;
  pubClient = null;
  if (!sub) return;
  try {
    await sub.quit();
  } catch {
    try {
      sub.disconnect();
    } catch {
      /* ignore */
    }
  }
}
