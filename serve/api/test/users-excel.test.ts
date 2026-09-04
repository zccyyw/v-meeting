import { describe, expect, it } from "vitest";
import { mapImportHeader, applyImportDefaults } from "../src/users-excel.js";

describe("users-excel", () => {
  it("maps zh/en headers", () => {
    expect(mapImportHeader("用户名")).toBe("username");
    expect(mapImportHeader("display_name")).toBe("displayName");
    expect(mapImportHeader("手机号")).toBe("phone");
  });

  it("applies create defaults", () => {
    expect(applyImportDefaults({ username: "a", displayName: "A" })).toEqual({
      username: "a",
      displayName: "A",
      phone: null,
      role: "user",
      status: "active",
      password: "123456",
    });
  });
});
