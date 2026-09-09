import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createPool } from "./db.js";
import { createRedis } from "./redis.js";
import { migrate } from "./migrate.js";
import { authRoutes } from "./routes/auth.js";
import { meetingRoutes } from "./routes/meetings.js";
import { recordingRoutes } from "./routes/recordings.js";
import { deptRoutes } from "./routes/sys-dept.js";
import { roleRoutes } from "./routes/sys-role.js";
import { menuRoutes } from "./routes/sys-menu.js";
import { sysUserRoutes } from "./routes/sys-user.js";
import { configRoutes } from "./routes/sys-config.js";
import { noticeRoutes } from "./routes/sys-notice.js";
import { operLogRoutes } from "./routes/sys-operlog.js";
import { userApprovalRoutes } from "./routes/sys-user-approval.js";
import { meetingAppRoutes } from "./routes/meeting-applications.js";
import { meetingGroupRoutes } from "./routes/meeting-groups.js";
import { caCertRoutes } from "./routes/ca-cert.js";
import { getConfigInt, getConfigBool } from "./config-cache.js";
import { isForceChangePassword } from "./auth.js";
import { registerOperLogHook } from "./middleware/oper-log.js";
import { cleanupExpiredLogs } from "./routes/sys-operlog.js";
import { ZodError } from "zod";

const app = Fastify({ logger: true });
const db = await createPool();
const redis = createRedis();

// 启动时自动执行数据库迁移（幂等，可重复执行）
try {
  const n = await migrate(db);
  app.log.info({ migrations: n }, "database migration completed");
} catch (err) {
  app.log.error({ err }, "database migration failed");
  throw err;
}

// ── 全局错误处理器：捕获 ZodError 返回 400，而非默认的 500 ──
app.setErrorHandler((err, req, reply) => {
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
  // 其他错误保持 Fastify 默认行为（500）
  reply.send(err);
});

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB for recordings
    files: 1,
  },
});

// ── 强制改密拦截：密码过期会话仅允许 /auth/me 与 /auth/change-password ──
app.addHook("preHandler", async (req, reply) => {
  const sid = req.headers["x-session-id"] as string | undefined;
  if (!sid) return; // 无会话（公开接口 / 访客流程）不拦截
  const url = req.url;
  if (url.startsWith("/auth/change-password")) return;
  if (url.startsWith("/auth/me")) return;
  if (url.startsWith("/sys-config/public")) return;
  if (await isForceChangePassword(redis, sid)) {
    return reply.code(403).send({ error: "password_change_required" });
  }
});

await authRoutes(app, db, redis);
await meetingRoutes(app, db, redis);
await recordingRoutes(app, db, redis);
await deptRoutes(app, db, redis);
await roleRoutes(app, db, redis);
await menuRoutes(app, db, redis);
await sysUserRoutes(app, db, redis);
await configRoutes(app, db, redis);
await noticeRoutes(app, db, redis);
await operLogRoutes(app, db, redis);
await userApprovalRoutes(app, db, redis);
await meetingAppRoutes(app, db, redis);
await meetingGroupRoutes(app, db, redis);
await caCertRoutes(app);

// 注册操作日志自动记录钩子
registerOperLogHook(app, db, redis);

// 定时清理过期日志（每 24 小时执行一次）
const logCleanupTimer = setInterval(async () => {
  try {
    const deleted = await cleanupExpiredLogs(db);
    if (deleted > 0) {
      app.log.info({ deleted }, "expired oper logs cleaned up");
      // 大批量 DELETE 后 WAL 瞬时膨胀，主动 checkpoint 归零便于磁盘监控与备份
      if (db.driver === "sqlite") {
        await db.query("PRAGMA wal_checkpoint(TRUNCATE)").catch(() => {});
      }
    }
  } catch (err) {
    app.log.error({ err }, "failed to cleanup expired oper logs");
  }
}, 24 * 60 * 60 * 1000);
// 不阻止进程正常退出
logCleanupTimer.unref();

app.get("/healthz", async () => ({ ok: true }));

// 前端获取系统配置（安全相关，只读）
app.get("/sys-config/public", async () => {
  const idleTimeout = await getConfigInt(db, "sys.session.idleTimeout", 600);
  const idleWarning = await getConfigInt(db, "sys.session.idleWarning", 60);
  return { idleTimeout, idleWarning };
});

const port = Number(process.env.API_PORT ?? 8080);
await app.listen({ port, host: "0.0.0.0" });

// ── 优雅停机 ──
// systemctl stop / docker stop 时先停止接收新请求、等待进行中的请求（含
// 1GB 录制上传）完成，再关闭数据库连接，避免中断上传与 SQLite 事务。
// 与 realtime 服务的 SIGTERM 处理保持一致。
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down gracefully");
  const forceExit = setTimeout(() => {
    app.log.warn("graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 30000));
  forceExit.unref();

  try {
    await app.close();
    app.log.info("http server closed");
  } catch (err) {
    app.log.error({ err }, "failed to close http server");
  }
  try {
    await db.end();
  } catch (err) {
    app.log.error({ err }, "failed to close database pool");
  }
  try {
    // ioredis 与内存 Redis 均提供 disconnect()
    await redis.disconnect();
  } catch {
    /* 关闭失败不影响退出 */
  }
  clearTimeout(forceExit);
  process.exit(0);
}

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    void shutdown(sig);
  });
}
