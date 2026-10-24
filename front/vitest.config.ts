import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 前端单测默认 node 环境（纯逻辑模块，如 media/room 的 snapshot 逻辑）；
    // 需要 DOM 的测试在文件内用 // @vitest-environment jsdom 声明
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
