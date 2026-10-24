import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { authRoutes } from "../src/routes/auth.js";
import { hashPassword } from "../src/auth.js";
import { encryptPassword } from "@meeting/shared";
import { createTestApp, mockDb, testRedis, type MockHandler } from "./helpers.js";

/**
 * 登录链路回归（架构审核 P0/P2 相关：
 * - 失败计数（暴力破解防护的观测面）；
 * - 成功响应契约（无密码 hash 泄露、mustChangePassword 标志语义）。
 * 注：默认口令的服务端强制（session_force）属 P2-1，落地后应在
 * "default password login" 用例追加 session_force 断言。
 */

const PLAIN = "Str0ng@Pass1";

async function setup(rows: Record<string, unknown>[]): Promise<{
  app: FastifyInstance;
  redis: ReturnType<typeof testRedis>;
}> {
  const app = createTestApp();
  const redis = testRedis();
  const handlers: MockHandler[] = [
    { match: /FROM sys_user WHERE user_name/, rows },
  ];
  await authRoutes(app, mockDb(handlers), redis);
  return { app, redis };
}

function injectLogin(app: FastifyInstance, password: string, username = "alice") {
  return app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { username, password },
  });
}

describe("POST /auth/login", () => {
  let app: FastifyInstance;
  let redis: ReturnType<typeof testRedis>;

  beforeEach(async () => {
    ({ app, redis } = await setup([
      {
        user_id: 1,
        user_name: "alice",
        nick_name: "Alice",
        password: await hashPassword(PLAIN),
        status: "0",
        del_flag: "0",
        pwd_update_date: null,
      },
    ]));
  });

  it("wrong password → 401 and increments attempt counter", async () => {
    const res = await injectLogin(app, await encryptPassword("wrong-pass"));

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
    // 失败计数写入（暴力破解锁定机制的观测面）
    expect(await redis.get("login_attempts:alice")).toBe("1");
  });

  it("unknown user → 401 without leaking account existence", async () => {
    ({ app, redis } = await setup([]));
    const res = await injectLogin(app, await encryptPassword("whatever"), "ghost");

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("invalid_credentials");
    expect(await redis.get("login_attempts:ghost")).toBe("1");
  });

  it("success → session contract: sessionId, flags, no password leak", async () => {
    const res = await injectLogin(app, await encryptPassword(PLAIN));

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.userId).toBe(1);
    expect(body.mustChangePassword).toBe(false);
    expect(body.passwordExpired).toBe(false);
    expect(Array.isArray(body.roles)).toBe(true);
    // 响应不得携带任何密码相关字段
    expect(body).not.toHaveProperty("password");
    expect(JSON.stringify(body)).not.toContain("$2a$"); // bcrypt hash 前缀
    // 成功后失败计数被清除
    expect(await redis.get("login_attempts:alice")).toBeNull();
  });

  it("default password login → mustChangePassword flag (P2-1 扩展点)", async () => {
    // 当前实现：仅回标志，服务端不强制（见 P2-1 计划）。
    // P2-1 落地后应追加：redis.get(`session_force:${body.sessionId}`) === "1"
    ({ app, redis } = await setup([
      {
        user_id: 2,
        user_name: "bob",
        nick_name: "Bob",
        password: await hashPassword("123456"),
        status: "0",
        del_flag: "0",
        pwd_update_date: null,
      },
    ]));

    const res = await injectLogin(app, await encryptPassword("123456"), "bob");

    expect(res.statusCode).toBe(200);
    expect(res.json().mustChangePassword).toBe(true);
  });
});
