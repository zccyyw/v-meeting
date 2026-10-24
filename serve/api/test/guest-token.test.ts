import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { meetingRoutes } from "../src/routes/meetings.js";
import { createTestApp, mockDb, testRedis, type MockHandler } from "./helpers.js";

/**
 * guest-token 路由回归（架构审核 P0-M5 频控修复的保护网）。
 * 该路由无会话鉴权（访客流程），故 IP 频控是其唯一枚举/轰炸防线。
 */

const MEETING_ROW = {
  id: 1,
  host_user_id: 99,
  status: "live",
  locked: 0,
  join_password_hash: null,
};

async function setup(rows: Record<string, unknown>[]): Promise<FastifyInstance> {
  const app = createTestApp();
  const handlers: MockHandler[] = [
    { match: /FROM meetings WHERE id = \?/, rows },
  ];
  await meetingRoutes(app, mockDb(handlers), testRedis());
  return app;
}

function injectGuest(app: FastifyInstance, displayName = "访客A") {
  return app.inject({
    method: "POST",
    url: "/meetings/1/guest-token",
    payload: { displayName },
  });
}

describe("POST /meetings/:id/guest-token", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await setup([MEETING_ROW]);
  });

  it("issues a guest token for an open meeting", async () => {
    const res = await injectGuest(app);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("guest");
    expect(body.meetingId).toBe(1);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("404 for unknown meeting id", async () => {
    app = await setup([]);
    const res = await injectGuest(app);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("not_found");
  });

  it("403 for locked meeting", async () => {
    app = await setup([{ ...MEETING_ROW, locked: 1 }]);
    const res = await injectGuest(app);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("meeting_locked");
  });

  it("409 for ended meeting", async () => {
    app = await setup([{ ...MEETING_ROW, status: "ended" }]);
    const res = await injectGuest(app);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("ended");
  });

  it("429 after 10 requests from same IP within 10 minutes (rate limit)", async () => {
    // 前 10 次放行
    for (let i = 0; i < 10; i++) {
      const res = await injectGuest(app, `访客${i}`);
      expect(res.statusCode).toBe(200);
    }
    // 第 11 次触发 IP 频控
    const blocked = await injectGuest(app, "访客X");
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe("too_many_requests");
  });
});
