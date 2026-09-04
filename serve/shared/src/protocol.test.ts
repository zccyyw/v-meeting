import { describe, it, expect } from "vitest";
import { JoinMeetingPayloadSchema } from "./protocol.js";

describe("JoinMeetingPayloadSchema", () => {
  it("accepts valid guest join", () => {
    const parsed = JoinMeetingPayloadSchema.parse({
      meetingId: "m1",
      displayName: "访客甲",
      role: "guest",
    });
    expect(parsed.role).toBe("guest");
  });

  it("rejects empty displayName", () => {
    expect(() =>
      JoinMeetingPayloadSchema.parse({
        meetingId: "m1",
        displayName: "",
        role: "guest",
      })
    ).toThrow();
  });
});
