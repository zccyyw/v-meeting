import { describe, it, expect } from "vitest";
import type { Db } from "@meeting/db";
import { mockDb, createTestApp, testRedis, type MockHandler } from "./helpers.js";
import { createSession } from "../src/auth.js";
import { meetingAppRoutes } from "../src/routes/meeting-applications.js";
import { registerErrorHandler } from "../src/error-handler.js";

// 回归测试（2026-10 线上故障）：首页「预定会议」提交会议申请返回 500。
// 根因：前端 toISOString() 的 '...T16:30:00.000Z' 被直接写进 MySQL DATETIME，
// 严格模式下触发 ER_TRUNCATED_WRONG_VALUE(1292) → 未被路由捕获 → 兜底 500。
// 另：表单 priority 默认值曾为中文 '中'，与后端枚举不匹配 → 400 validation_error。

const SYS_USER_ROW = [
  {
    user_id: 15,
    dept_id: null,
    user_name: "tester",
    nick_name: "测试用户",
    status: "0",
    phonenumber: null,
    email: null,
    del_flag: "0",
  },
];

async function postApplication(
  driver: Db["driver"],
  body: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown>; insertParams?: unknown[] }> {
  let insertParams: unknown[] | undefined;
  const handlers: MockHandler[] = [
    { match: /FROM sys_user WHERE user_id/i, rows: SYS_USER_ROW },
    {
      match: /INSERT INTO meeting_applications/i,
      header: { insertId: 42, affectedRows: 1 },
    },
  ];
  const db: Db = {
    ...mockDb(handlers, driver),
    async query(sql: string, params: unknown[] = []) {
      if (/INSERT INTO meeting_applications/i.test(sql)) insertParams = params;
      return mockDb(handlers, driver).query(sql, params);
    },
  };

  const app = createTestApp();
  registerErrorHandler(app);
  // 同一个 redis 实例：路由与建会话必须共享会话存储（MemoryRedis 每次新建互不共享）
  const redis = testRedis();
  await app.register(async (instance) => meetingAppRoutes(instance, db, redis));
  const sid = await createSession(redis, 15);
  const res = await app.inject({
    method: "POST",
    url: "/meeting-applications",
    headers: { "x-session-id": sid },
    payload: body,
  });
  await app.close();
  return {
    status: res.statusCode,
    json: res.json() as Record<string, unknown>,
    insertParams,
  };
}

const BASE_BODY = {
  title: "11",
  meetingTime: "2026-10-30T16:30:00.000Z",
  endTime: "2026-10-31T16:30:00.000Z",
  location: "sh",
  deptCount: 10,
  priority: "high",
};

describe("POST /meeting-applications 时间入参归一化", () => {
  it("MySQL：写入 DATETIME 的字面量必须不带时区后缀（1292 回归）", async () => {
    const { status, insertParams } = await postApplication("mysql", BASE_BODY);
    expect(status).toBe(201);
    expect(insertParams).toBeDefined();
    const [, , meetingTime, endTime] = insertParams as unknown[];
    // 修复前为 '2026-10-30T16:30:00.000Z' → MySQL 严格模式报 1292
    expect(meetingTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(endTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // 瞬时点不能丢：应等于该时刻在服务端本地时区的墙上时间
    const p = (n: number) => String(n).padStart(2, "0");
    const wall = (iso: string) => {
      const d = new Date(iso);
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
        d.getHours(),
      )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    expect(meetingTime).toBe(wall("2026-10-30T16:30:00.000Z"));
    expect(endTime).toBe(wall("2026-10-31T16:30:00.000Z"));
  });

  it("SQLite：沿用带 T/Z 的 ISO-8601（与 datetime('now') 同基准）", async () => {
    const { status, insertParams } = await postApplication("sqlite", BASE_BODY);
    expect(status).toBe(201);
    const [, , meetingTime] = insertParams as unknown[];
    expect(meetingTime).toBe("2026-10-30T16:30:00.000Z");
  });

  it("非法时间返回 400 而非 500", async () => {
    const { status, json } = await postApplication("mysql", {
      ...BASE_BODY,
      meetingTime: "not-a-date",
    });
    expect(status).toBe(400);
    expect(json.error).toBe("invalid_meeting_time");
  });
});

describe("POST /meeting-applications 优先级编码", () => {
  it("英文机器码原样落库", async () => {
    const { status, insertParams } = await postApplication("mysql", BASE_BODY);
    expect(status).toBe(201);
    const [, , , , , , priority] = insertParams as unknown[];
    expect(priority).toBe("high");
  });

  it("历史中文值折算为机器码（旧客户端/直连写入兼容）", async () => {
    const { status, insertParams } = await postApplication("mysql", {
      ...BASE_BODY,
      priority: "中",
    });
    expect(status).toBe(201);
    const [, , , , , , priority] = insertParams as unknown[];
    expect(priority).toBe("medium");
  });

  it("省略 priority 时取默认值 medium", async () => {
    const rest: Record<string, unknown> = { ...BASE_BODY };
    delete rest.priority;
    const { status, insertParams } = await postApplication("mysql", rest);
    expect(status).toBe(201);
    const [, , , , , , p] = insertParams as unknown[];
    expect(p).toBe("medium");
  });
});
