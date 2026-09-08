import { Redis } from "ioredis";

/**
 * Minimal in-memory Redis-compatible store for single-node deployments.
 * Implements only the subset of ioredis methods used by this app:
 *   get, set (with EX), del
 */
class MemoryRedis {
  private store = new Map<string, { value: string; expireAt?: number }>();

  constructor() {
    // 周期性清扫过期条目：惰性删除（get 触碰时）之外，login_attempts:*/
    // login_lock:*/session_force:* 等不再被访问的 key 会永久驻留，
    // 用户名喷洒场景下内存无上限增长。60s 全量清扫一次即可封顶。
    const sweeper = setInterval(() => this.sweep(), 60_000);
    // 不阻止进程正常退出
    sweeper.unref();
  }

  /** 删除所有已过期条目（全量遍历，O(n)，n 为当前 key 数）。 */
  private sweep() {
    for (const [k, v] of this.store) {
      if (this.isExpired(v)) this.store.delete(k);
    }
  }

  private isExpired(entry: { value: string; expireAt?: number }) {
    return entry.expireAt !== undefined && Date.now() > entry.expireAt;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    mode?: string,
    ttlSeconds?: number
  ): Promise<string> {
    const entry: { value: string; expireAt?: number } = { value };
    if (mode === "EX" && typeof ttlSeconds === "number") {
      entry.expireAt = Date.now() + ttlSeconds * 1000;
    }
    this.store.set(key, entry);
    return "OK";
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.store.delete(k)) n++;
    }
    return n;
  }

  /**
   * 统计前缀匹配、未过期且 value 不同（去重）的用户数，供“在线用户”统计。
   * 会话 value 即 userId，故按 value 去重可得到一个用户多端登录只计一次。
   */
  async countUsers(prefix: string): Promise<number> {
    const users = new Set<string>();
    for (const [k, v] of this.store) {
      if (!k.startsWith(prefix)) continue;
      if (this.isExpired(v)) {
        this.store.delete(k);
        continue;
      }
      users.add(v.value);
    }
    return users.size;
  }

  async disconnect(): Promise<void> {
    this.store.clear();
  }
}

/**
 * 当前在线用户数：以 session:* 为唯一事实来源（会话自带 TTL，
 * Redis / MemoryRedis 均会在过期后自动消失，无需额外清理）。
 * 按 userId 去重统计——同一账号多端登录只计为 1 个在线用户。
 */
export async function countOnlineUsers(redis: Redis): Promise<number> {
  const memory = redis as unknown as {
    countUsers?: (prefix: string) => Promise<number>;
  };
  if (typeof memory.countUsers === "function") {
    return memory.countUsers("session:");
  }
  const keys = await redis.keys("session:*");
  if (keys.length === 0) return 0;
  const users = new Set<string>();
  for (const k of keys) {
    const uid = await redis.get(k);
    if (uid != null) users.add(uid);
  }
  return users.size;
}

export type AppRedis = ReturnType<typeof createRedis>;

export function createRedis() {
  const host = process.env.REDIS_HOST;

  // No Redis configured or explicitly set to "memory" → use in-memory store.
  // This enables zero-dependency single-node deployment (no Redis needed).
  if (!host || host === "memory") {
    console.log("[redis] using in-memory session store (single-node mode)");
    return new MemoryRedis() as unknown as Redis;
  }

  return new Redis({
    host,
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
}
