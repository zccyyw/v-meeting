/**
 * 信令生命周期回归测试（不依赖 mediasoup / 真实服务）。
 *
 * 覆盖本轮修复的状态同步与生命周期逻辑：
 *  - 入会快照带上 allowShare / 成员媒体与录制状态
 *  - 应用层心跳 ping → pong
 *  - 关闭等待室时自动准入等待中的成员
 *  - 同一账号多端参会：新端顶掉旧端
 *  - 房间空置超过宽限期自动置为 ended
 *  - 主持人离开超过宽限期自动结束会议
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

// 必须在导入 signal.ts 之前设置：宽限期常量在模块加载时读取
process.env.MEETING_EMPTY_ROOM_GRACE_MS = "40";
process.env.MEETING_HOST_RECONNECT_GRACE_MS = "40";
process.env.MEETING_STALE_SWEEP_MS = "0";

const hoisted = vi.hoisted(() => ({
  authQueue: [] as Array<Record<string, unknown> | null>,
}));

vi.mock("../src/mediasoup.js", () => ({
  createRouter: async () => ({ rtpCapabilities: {}, close: () => {} }),
  createWebRtcTransport: async () => ({}),
}));

vi.mock("../src/auth-bridge.js", () => ({
  validateJoinToken: async () => hoisted.authQueue.shift() ?? null,
}));

type Sent = { type: string; [key: string]: any };

class FakeWs {
  readyState = 1;
  readonly OPEN = 1;
  sent: Sent[] = [];
  private handlers = new Map<string, Array<(...args: any[]) => void>>();

  send(data: string) {
    this.sent.push(JSON.parse(data) as Sent);
  }

  ping() {
    /* noop */
  }

  on(event: string, cb: (...args: any[]) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
  }

  emit(event: string, ...args: any[]) {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }

  close() {
    this.readyState = 3;
    this.emit("close");
  }

  of(type: string) {
    return this.sent.filter((m) => m.type === type);
  }

  last(type: string) {
    const list = this.of(type);
    return list[list.length - 1] as Sent | undefined;
  }
}

const dbQueries: string[] = [];
const db = {
  driver: "sqlite",
  query: async (sql: string) => {
    dbQueries.push(sql);
    return [[], {}];
  },
};

const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function auth(over: Record<string, unknown> = {}) {
  return {
    meetingId: "m1",
    userId: "1",
    role: "host",
    displayName: "User",
    waitingRoomEnabled: false,
    recordAllowed: false,
    allowShare: true,
    meetingStatus: "live",
    ...over,
  };
}

let createSignalHandler: (db: unknown) => {
  onConnection(ws: unknown): Promise<void>;
};

beforeAll(async () => {
  const mod = await import("../src/signal.js");
  createSignalHandler = mod.createSignalHandler as never;
});

function newHandler() {
  return createSignalHandler(db as never);
}

async function join(handler: ReturnType<typeof newHandler>, ws: FakeWs) {
  await handler.onConnection(ws);
  ws.emit("message", JSON.stringify({ type: "join", token: "t", displayName: "U" }));
  await tick();
}

describe("信令生命周期", () => {
  it("入会快照带上 allowShare 与成员媒体/录制状态", async () => {
    hoisted.authQueue.push(
      auth({ userId: "1", role: "host", allowShare: false }),
      auth({ userId: "2", role: "participant" })
    );
    const handler = newHandler();
    const host = new FakeWs();
    await join(handler, host);
    const hostJoined = host.last("joined") as Sent;
    expect(hostJoined).toBeTruthy();
    expect(hostJoined.allowShare).toBe(false);

    const guest = new FakeWs();
    await join(handler, guest);
    const guestJoined = guest.last("joined") as Sent;
    // 房间已存在 → 以房间权威值为准（主持人此前关闭了共享）
    expect(guestJoined.allowShare).toBe(false);
    const hostEntry = (guestJoined.peers as Sent[]).find((p) => p.peerId === hostJoined.peerId) as Sent;
    expect(hostEntry).toBeTruthy();
    // 无 producer 时媒体/录制字段也必须在快照里显式给出
    expect(hostEntry.camEnabled).toBe(false);
    expect(hostEntry.micEnabled).toBe(false);
    expect(hostEntry.recording).toBe(false);
  });

  it("应用层心跳：ping 回 pong", async () => {
    hoisted.authQueue.push(auth());
    const handler = newHandler();
    const ws = new FakeWs();
    await join(handler, ws);
    ws.emit("message", JSON.stringify({ type: "ping" }));
    await tick();
    expect(ws.last("pong")).toBeTruthy();
  });

  it("关闭等待室时自动准入等待中的成员", async () => {
    hoisted.authQueue.push(
      auth({ userId: "1", role: "host", waitingRoomEnabled: true }),
      auth({ userId: "2", role: "guest" })
    );
    const handler = newHandler();
    const host = new FakeWs();
    const guest = new FakeWs();
    await join(handler, host);
    await join(handler, guest);
    expect(guest.last("waiting")).toBeTruthy();
    expect(guest.last("joined")).toBeFalsy();

    host.emit(
      "message",
      JSON.stringify({ type: "host", action: "setWaitingRoom", waitingRoomEnabled: false })
    );
    await tick(40);
    expect(guest.last("joined")).toBeTruthy();
    // 等待室开关需要落库，否则房间重建会回退
    expect(dbQueries.some((q) => q.includes("waiting_room_enabled"))).toBe(true);
  });

  it("同一账号多端参会：新端顶掉旧端", async () => {
    hoisted.authQueue.push(
      auth({ userId: "7", role: "host" }),
      auth({ userId: "7", role: "host" })
    );
    const handler = newHandler();
    const first = new FakeWs();
    const second = new FakeWs();
    await join(handler, first);
    await join(handler, second);
    expect(first.last("kicked")?.reason).toBe("replaced_by_new_session");
    expect(second.last("joined")).toBeTruthy();
  });

  it("最后一名成员离开后，空置超过宽限期自动置 ended", async () => {
    hoisted.authQueue.push(auth({ userId: "2", role: "guest" }));
    const handler = newHandler();
    const guest = new FakeWs();
    await join(handler, guest);
    dbQueries.length = 0;

    guest.emit("message", JSON.stringify({ type: "leave" }));
    await tick(20);
    expect(dbQueries.some((q) => q.includes("status = 'ended'"))).toBe(false);

    await tick(140);
    expect(
      dbQueries.some((q) => q.includes("status = 'ended'") && q.includes("meetings"))
    ).toBe(true);
  });

  it("主持人离开会议页（发 leave）：不立即结束，窗口内可重进", async () => {
    hoisted.authQueue.push(
      auth({ userId: "1", role: "host" }),
      auth({ userId: "2", role: "participant" }),
      // 主持人误操作离开后重新进入
      auth({ userId: "1", role: "host" })
    );
    const handler = newHandler();
    const host = new FakeWs();
    const guest = new FakeWs();
    await join(handler, host);
    await join(handler, guest);

    // 浏览器返回 / 路由跳走 → 前端发 leave：不应散会
    host.emit("message", JSON.stringify({ type: "leave" }));
    await tick(20);
    expect(guest.last("meetingEnded")).toBeFalsy();

    // 窗口内主持人重新进入 → 会议继续，且不再被超时结束
    const hostAgain = new FakeWs();
    await join(handler, hostAgain);
    expect(hostAgain.last("joined")).toBeTruthy();
    await tick(140);
    expect(guest.last("meetingEnded")).toBeFalsy();
  });

  it("主持人点结束会议：立即结束", async () => {
    hoisted.authQueue.push(
      auth({ userId: "1", role: "host" }),
      auth({ userId: "2", role: "participant" })
    );
    const handler = newHandler();
    const host = new FakeWs();
    const guest = new FakeWs();
    await join(handler, host);
    await join(handler, guest);

    host.emit("message", JSON.stringify({ type: "host", action: "endMeeting" }));
    await tick(20);
    // 唯一会立即散会的路径
    expect(guest.last("meetingEnded")).toBeTruthy();
  });

  it("主持人被动离线：宽限期内不结束，超时后结束", async () => {
    hoisted.authQueue.push(
      auth({ userId: "1", role: "host" }),
      auth({ userId: "2", role: "participant" })
    );
    const handler = newHandler();
    const host = new FakeWs();
    const guest = new FakeWs();
    await join(handler, host);
    await join(handler, guest);

    // 断网 / 崩溃：连接被动关闭，而不是客户端主动 leave
    host.emit("close");
    await tick(20);
    expect(guest.last("meetingEnded")).toBeFalsy();

    await tick(140);
    expect(guest.last("meetingEnded")).toBeTruthy();
  });

  it("主持人从未入会（参会者早到）不会被重连窗口结束", async () => {
    hoisted.authQueue.push(auth({ userId: "2", role: "participant" }));
    const handler = newHandler();
    const guest = new FakeWs();
    await join(handler, guest);
    dbQueries.length = 0;

    await tick(160);
    expect(guest.last("meetingEnded")).toBeFalsy();
    expect(dbQueries.some((q) => q.includes("status = 'ended'"))).toBe(false);
  });
});
