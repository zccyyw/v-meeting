import { describe, it, expect } from "vitest";
import { resolveRedisDb } from "../src/redis.js";

describe("resolveRedisDb", () => {
  it("defaults to db 0 when REDIS_DATABASE is absent", () => {
    expect(resolveRedisDb({} as NodeJS.ProcessEnv)).toBe(0);
  });

  it("defaults to db 0 when REDIS_DATABASE is blank", () => {
    expect(
      resolveRedisDb({ REDIS_DATABASE: "" } as NodeJS.ProcessEnv),
    ).toBe(0);
    expect(
      resolveRedisDb({ REDIS_DATABASE: "   " } as NodeJS.ProcessEnv),
    ).toBe(0);
  });

  it("uses the configured database number", () => {
    expect(
      resolveRedisDb({ REDIS_DATABASE: "3" } as NodeJS.ProcessEnv),
    ).toBe(3);
  });

  it("rejects negative / non-numeric values", () => {
    expect(() =>
      resolveRedisDb({ REDIS_DATABASE: "-1" } as NodeJS.ProcessEnv),
    ).toThrow(/REDIS_DATABASE/);
    expect(() =>
      resolveRedisDb({ REDIS_DATABASE: "abc" } as NodeJS.ProcessEnv),
    ).toThrow(/REDIS_DATABASE/);
    expect(() =>
      resolveRedisDb({ REDIS_DATABASE: "1.5" } as NodeJS.ProcessEnv),
    ).toThrow(/REDIS_DATABASE/);
  });

  it("allows large indexes (server may raise databases)", () => {
    expect(
      resolveRedisDb({ REDIS_DATABASE: "31" } as NodeJS.ProcessEnv),
    ).toBe(31);
  });
});
