import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { z } from "zod";
import { registerErrorHandler } from "../src/error-handler.js";
import { createTestApp } from "./helpers.js";

/**
 * 全局错误处理器回归（架构审核 P0-M1 修复的保护网）：
 * 5xx 不得把 err.message（SQL/驱动内部细节）发给客户端。
 */
describe("registerErrorHandler", () => {
  function buildApp() {
    const app = createTestApp();
    registerErrorHandler(app);
    return app;
  }

  it("masks 5xx internals as internal_error (no SQL/driver details leaked)", async () => {
    const app = buildApp();
    app.get("/boom", async () => {
      throw new Error(
        'SQLITE_ERROR: no such table: secret_table near "SELECT * FROM secret_users"',
      );
    });

    const res = await app.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe("internal_error");
    // 内部细节不得出现在响应体中
    expect(res.body).not.toContain("SQLITE_ERROR");
    expect(res.body).not.toContain("secret_table");
    expect(res.body).not.toContain("SELECT");
  });

  it("passes through controlled 4xx business messages", async () => {
    const app = buildApp();
    app.get("/forbidden", async () => {
      const err = new Error("password_required") as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    });

    const res = await app.inject({ method: "GET", url: "/forbidden" });

    expect(res.statusCode).toBe(403);
    // 4xx 业务错误保持透传（前端 errors.<code> 映射依赖此契约）
    expect(res.json().error).toBe("password_required");
  });

  it("returns 400 validation_error with field details for ZodError", async () => {
    const app = buildApp();
    const Schema = z.object({ displayName: z.string().min(1) });
    app.get("/validate", async () => {
      Schema.parse({ displayName: "" });
      return { ok: true };
    });

    const res = await app.inject({ method: "GET", url: "/validate" });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("validation_error");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details[0].path).toBe("displayName");
  });

  it("ZodError instance is detected (not masked as 500)", async () => {
    const app = buildApp();
    app.get("/zod", async () => {
      throw new ZodError([]);
    });

    const res = await app.inject({ method: "GET", url: "/zod" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation_error");
  });
});
