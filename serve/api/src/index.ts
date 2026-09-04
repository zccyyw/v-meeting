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
import { getConfigInt, getConfigBool } from "./config-cache.js";
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

// 注册操作日志自动记录钩子
registerOperLogHook(app, db, redis);

// 定时清理过期日志（每 24 小时执行一次）
setInterval(async () => {
  try {
    const deleted = await cleanupExpiredLogs(db);
    if (deleted > 0) {
      app.log.info({ deleted }, "expired oper logs cleaned up");
    }
  } catch (err) {
    app.log.error({ err }, "failed to cleanup expired oper logs");
  }
}, 24 * 60 * 60 * 1000);

app.get("/healthz", async () => ({ ok: true }));

// 前端获取系统配置（安全相关，只读）
app.get("/sys-config/public", async () => {
  const idleTimeout = await getConfigInt(db, "sys.session.idleTimeout", 600);
  const idleWarning = await getConfigInt(db, "sys.session.idleWarning", 60);
  return { idleTimeout, idleWarning };
});

const port = Number(process.env.API_PORT ?? 8080);
await app.listen({ port, host: "0.0.0.0" });
