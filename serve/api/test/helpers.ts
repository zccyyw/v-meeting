import Fastify, { type FastifyInstance } from "fastify";
import type { Db, ResultHeader } from "@meeting/db";
import type { Redis } from "ioredis";
import { createRedis } from "../src/redis.js";
import { resetTableExistsCache } from "../src/sql-utils.js";

/**
 * 路由级测试基建：mock Db + 真 MemoryRedis + 干净 Fastify 实例。
 * 不启动真实 server（api/src/index.ts 顶层有建连/迁移副作用，不可 import），
 * 改为向测试实例注册单个路由模块后用 app.inject 打请求。
 */

export type MockHandler = {
  /** 匹配 SQL 文本 */
  match: RegExp;
  /** 返回行（默认 []） */
  rows?: unknown[];
  /** 返回头（默认空 header） */
  header?: ResultHeader;
  /** 抛出该错误（用于 5xx 脱敏测试） */
  error?: Error;
};

/**
 * 智能 mock Db：按 SQL 依序匹配 handlers；未命中时——
 * - sqlite_master/information_schema 类查询（tableExists）返回指定表名存在，
 *   使代码走 sys_user 新表路径；
 * - 其余返回空结果（getConfig 等走默认值分支）。
 */
export function mockDb(handlers: MockHandler[] = []): Db {
  return {
    driver: "sqlite",
    async query(sql: string, params: unknown[] = []) {
      for (const h of handlers) {
        if (h.match.test(sql)) {
          if (h.error) throw h.error;
          return [h.rows ?? [], h.header ?? { insertId: 0, affectedRows: 0 }];
        }
      }
      if (/sqlite_master|information_schema|pg_catalog/i.test(sql)) {
        // tableExists(db, name)：name 作为参数传入；sys_user_role 故意不存在，
        // 使 loadSessionUser 走无 RBAC 表回退分支（roles=[]），减少 mock 面
        const name = String(params[0] ?? "");
        const exists = name === "sys_user";
        return [exists ? [{ name }] : [], { insertId: 0, affectedRows: 0 }];
      }
      return [[], { insertId: 0, affectedRows: 0 }];
    },
  };
}

/** 干净的 Fastify 实例（无日志噪音，重置 tableExists 缓存）。 */
export function createTestApp(): FastifyInstance {
  process.env.REDIS_HOST = "memory";
  resetTableExistsCache();
  return Fastify({ logger: false });
}

/** 真 MemoryRedis（get/set/del/countUsers 已实现），每次调用返回新实例，
 *  测试间计数/限流状态天然隔离。 */
export function testRedis(): Redis {
  process.env.REDIS_HOST = "memory";
  return createRedis();
}
