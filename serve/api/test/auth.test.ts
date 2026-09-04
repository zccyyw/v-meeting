import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth.js";

describe("password", () => {
  it("verifies hashed password", async () => {
    const hash = await hashPassword("secret123");
    expect(await verifyPassword("secret123", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
