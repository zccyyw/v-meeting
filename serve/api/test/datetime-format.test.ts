import { describe, it, expect } from "vitest";
import { formatLocalDateTime, parseDateTime, epochMs } from "@meeting/db";

// 回归测试：TZ 切换为 Asia/Shanghai 后，历史会议列表/详情/realtime 纪要的时间曾因
// "toISOString() → 去掉 Z → new Date(按本地解析)" 的往返而整体偏移 8 小时。
// 该往返只在进程 TZ=UTC 时自洽，因此必须改为"本地墙上时间格式化 + 同一口径反解"。

describe("展示时间口径（部署统一 Asia/Shanghai）", () => {
  it("输出 'YYYY-MM-DD HH:mm:ss'，不带 T/Z", () => {
    const s = formatLocalDateTime(new Date("2026-10-30T17:00:00Z"));
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(s).not.toContain("T");
    expect(s).not.toContain("Z");
  });

  it("往返不漂移：格式化后再取时间戳应等于原瞬时点（与进程 TZ 无关）", () => {
    const d = new Date("2026-10-30T17:00:00Z");
    const s = formatLocalDateTime(d);
    expect(s).not.toBeNull();
    // 秒级对齐：格式化丢弃毫秒
    expect(Math.floor(epochMs(s!) / 1000)).toBe(Math.floor(d.getTime() / 1000));
  });

  it("无时区串按本地解析，格式化为恒等（SQLite 路径同此口径）", () => {
    const naive = "2026-10-31 01:00:00";
    expect(formatLocalDateTime(naive)).toBe(naive);
    expect(epochMs(naive)).toBe(new Date("2026-10-31T01:00:00").getTime());
  });

  it("空值/非法值：格式化返回 null，时间戳返回 NaN", () => {
    expect(formatLocalDateTime(null)).toBeNull();
    expect(formatLocalDateTime("")).toBeNull();
    expect(formatLocalDateTime("not-a-date")).toBeNull();
    expect(parseDateTime(undefined)).toBeNull();
    expect(Number.isNaN(epochMs(null))).toBe(true);
  });
});
