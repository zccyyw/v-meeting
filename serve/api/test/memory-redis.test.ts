import { describe, it, expect } from "vitest";
import { createRedis, countOnlineUsers } from "../src/redis.js";

// 强制内存模式：测试脚手架加载的 .env 中 REDIS_HOST=127.0.0.1，这里显式覆盖
process.env.REDIS_HOST = "memory";

describe("MemoryRedis proxy fail-fast (P2-9)", () => {
  it("supports implemented methods (get/set/del/countUsers)", async () => {
    const redis = createRedis();
    await redis.set("k1", "v1", "EX", 60);
    expect(await redis.get("k1")).toBe("v1");
    expect(await redis.del("k1")).toBe(1);
    expect(await redis.get("k1")).toBeNull();
    expect(await countOnlineUsers(redis)).toBe(0);
  });

  it("keeps feature-detection contract: duplicate stays absent", () => {
    const redis = createRedis();
    expect(
      (redis as unknown as { duplicate?: unknown }).duplicate
    ).toBeUndefined();
  });

  it("throws a clear error when calling unimplemented methods", () => {
    const redis = createRedis();
    expect(() =>
      (redis as unknown as { incr: (key: string) => Promise<number> }).incr("n")
    ).toThrow(/MemoryRedis does not implement incr/);
  });
});