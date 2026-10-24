import { describe, it, expect } from "vitest";
import { MediaRoom } from "./room.js";
import type { SignalClient } from "@/signal/client";

/**
 * getSnapshot 引用稳定性回归（架构审核 P3-A 优化保护）：
 * RTT 广播约 1s/次，若集合字段每次返回新引用，会议页将每秒全树重渲染。
 * 内容未变时集合引用必须与上次快照相同（React 按 Object.is 跳过渲染）。
 */

function fakeSignal(): SignalClient {
  return {
    setUnexpectedCloseHandler() {},
    async connect() {},
    send() {},
    onMessage() {
      return () => {};
    },
    close() {},
  } as unknown as SignalClient;
}

describe("MediaRoom.getSnapshot", () => {
  it("returns stable collection references when content is unchanged", () => {
    const room = new MediaRoom({
      signal: fakeSignal(),
      token: "t",
      displayName: "me",
    });

    const a = room.getSnapshot();
    const b = room.getSnapshot();

    // 集合引用复用（核心断言）
    expect(b.remoteStreams).toBe(a.remoteStreams);
    expect(b.screenStreams).toBe(a.screenStreams);
    expect(b.screenAudioStreams).toBe(a.screenAudioStreams);
    expect(b.peers).toBe(a.peers);
    expect(b.waitingPeers).toBe(a.waitingPeers);
    expect(b.chatMessages).toBe(a.chatMessages);
    expect(b.peerRtt).toBe(a.peerRtt);

    // 顶层对象仍每次新建（标量字段可变），由消费侧 Object.is 决定是否重渲染
    expect(b).not.toBe(a);
  });
});

describe("MediaRoom hostPipEnabled (presenter PIP switch)", () => {
  function createRoom() {
    return new MediaRoom({ signal: fakeSignal(), token: "t", displayName: "me" });
  }

  it("defaults to true (old server without the field keeps PIP visible)", () => {
    const room = createRoom();
    expect(room.getSnapshot().hostPipEnabled).toBe(true);
  });

  it("setHostPipEnabled sends signal and updates snapshot", () => {
    const room = createRoom();
    room.setHostPipEnabled(false);
    expect(room.getSnapshot().hostPipEnabled).toBe(false);
    room.setHostPipEnabled(true);
    expect(room.getSnapshot().hostPipEnabled).toBe(true);
  });
});
