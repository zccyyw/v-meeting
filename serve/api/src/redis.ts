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

/**
 * MemoryRedis 未实现方法 fail-fast（架构评审 P2-9）。
 *
 * 背景：MemoryRedis 只实现 get/set/del/countUsers/disconnect，但各模块拿到的
 * 是完整 ioredis 类型——任何代码调用未实现方法（如 incr/expire）在单机内存
 * 模式下会以"undefined is not a function"崩在运行中期，难以定位。
 * 用 Proxy 包装：未实现方法调用即抛出带明确指引的错误，把炸点前移到启动冒烟。
 *
 * 特性探测契约（必须保持"缺席"语义，不能返回函数）：
 * - notify.ts 的 canPubSub 依赖 duplicate 不存在 → 内存模式降级为进程内 EventEmitter；
 * - countOnlineUsers 依赖 countUsers 存在（该方法在 target 上，不受影响）。
 */
const MEMORY_REDIS_ABSENT_PROPS = new Set([
  "duplicate",
  "subscribe",
  "psubscribe",
  "unsubscribe",
  "punsubscribe",
]);

function wrapMemoryRedis(memory: MemoryRedis): Redis {
  return new Proxy(memory, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (MEMORY_REDIS_ABSENT_PROPS.has(prop)) return undefined;
      return (...args: unknown[]) => {
        void args;
        throw new Error(
          `[redis] MemoryRedis does not implement ${prop}() — add it to MemoryRedis or configure a real Redis via REDIS_HOST`
        );
      };
    },
  }) as unknown as Redis;
}
/**
 * 解析 REDIS_DATABASE（Redis 库序号）。
 * - 未设或留空 → 0（Redis 默认库）
 * - 非法值（非非负整数）→ 直接抛错：宁可启动失败，也不要连上后才发现连错库
 * 不写死上限（Redis 默认 16 库）：服务端把 databases 调大时可指定更大的库号。
 */
export function resolveRedisDb(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REDIS_DATABASE?.trim();
  if (!raw) return 0;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`[redis] REDIS_DATABASE 必须是非负整数，当前值 "${raw}"`);
  }
  return Number(raw);
}

export function createRedis() {
  const host = process.env.REDIS_HOST;

  // No Redis configured or explicitly set to "memory" → use in-memory store.
  // This enables zero-dependency single-node deployment (no Redis needed).
  if (!host || host === "memory") {
    console.log("[redis] using in-memory session store (single-node mode)");
    return wrapMemoryRedis(new MemoryRedis());
  }

  return new Redis({
    host,
    port: Number(process.env.REDIS_PORT ?? 6379),
    // 留空 = 不使用密码（undefined 时 ioredis 不发 AUTH）
    password: process.env.REDIS_PASSWORD || undefined,
    // 库序号：REDIS_DATABASE（未设/留空 → 0）
    db: resolveRedisDb(),
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
}
