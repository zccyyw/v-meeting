import { describe, it, expect } from "vitest";
import { mapUserRow } from "../src/session-user.js";

describe("mapUserRow", () => {
  it("maps active admin row to AppUser", () => {
    expect(
      mapUserRow({
        id: 1,
        username: "admin",
        display_name: "Admin",
        role: "admin",
        status: "active",
        phone: null,
      })
    ).toEqual({
      id: 1,
      username: "admin",
      displayName: "Admin",
      role: "admin",
      status: "active",
      phone: null,
    });
  });

  it("maps active user row with phone", () => {
    expect(
      mapUserRow({
        id: 2,
        username: "alice",
        display_name: "Alice",
        role: "user",
        status: "active",
        phone: "13800000000",
      })
    ).toEqual({
      id: 2,
      username: "alice",
      displayName: "Alice",
      role: "user",
      status: "active",
      phone: "13800000000",
    });
  });

  it("defaults unknown role to user", () => {
    const user = mapUserRow({
      id: 3,
      username: "bob",
      display_name: "Bob",
      role: "moderator",
      status: "active",
      phone: null,
    });
    expect(user?.role).toBe("user");
  });

  it("returns null for disabled user", () => {
    expect(
      mapUserRow({
        id: 4,
        username: "disabled",
        display_name: "Disabled",
        role: "user",
        status: "disabled",
        phone: null,
      })
    ).toBeNull();
  });

  it("returns null for missing row", () => {
    expect(mapUserRow(undefined)).toBeNull();
    expect(mapUserRow(null)).toBeNull();
  });
});
