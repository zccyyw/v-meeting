import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

/**
 * 全局错误处理器（自 index.ts 抽取，便于单测）：
 * - ZodError → 400 validation_error（字段级 details）；
 * - 5xx：记服务端日志，对客户端只回通用 internal_error——
 *   直接 reply.send(err) 会把 err.message（可能含 SQL 语句/驱动内部
 *   细节/文件路径）序列化后发给客户端，属信息泄露；
 * - 4xx：业务错误的 message 为受控文案（路由显式构造），保持透传以不
 *   破坏前端 errors.<code> 映射。
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((
    err: Error & { statusCode?: number },
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      });
    }
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) {
      req.log.error({ err }, "unhandled server error");
      return reply.code(500).send({ error: "internal_error" });
    }
    return reply
      .code(statusCode)
      .send({ error: err.message ?? "error" });
  });
}
