import { describe, expect, it } from "vitest";
import { canRemoveAdminRole } from "../src/users-guards.js";

describe("canRemoveAdminRole", () => {
  it("blocks when target is admin and only one admin remains", () => {
    expect(
      canRemoveAdminRole({ targetRole: "admin", activeAdminCount: 1 })
    ).toBe(false);
  });
  it("allows when another admin exists", () => {
    expect(
      canRemoveAdminRole({ targetRole: "admin", activeAdminCount: 2 })
    ).toBe(true);
  });
  it("allows when target is not admin", () => {
    expect(
      canRemoveAdminRole({ targetRole: "user", activeAdminCount: 1 })
    ).toBe(true);
  });
});
