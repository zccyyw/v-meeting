import { Redis } from "ioredis";

/**
 * Minimal in-memory Redis-compatible store for single-node deployments.
 * Implements only the subset of ioredis methods used by this app:
 *   get, set (with EX), del
 */
class MemoryRedis {
  private store = new Map<string, { value: string; expireAt?: number }>();

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

  async disconnect(): Promise<void> {
    this.store.clear();
  }
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
