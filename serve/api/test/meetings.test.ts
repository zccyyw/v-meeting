import { describe, it, expect } from "vitest";
import { generateMeetingCode } from "../src/meeting-code.js";

describe("generateMeetingCode", () => {
  it("returns 9 digits", () => {
    const code = generateMeetingCode(() => Buffer.from([0, 0, 0, 1]));
    expect(code).toMatch(/^\d{9}$/);
  });
});
