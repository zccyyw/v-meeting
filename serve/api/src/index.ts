import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { createPool } from "./db.js";
import { createRedis } from "./redis.js";
import { initNotify, closeNotify } from "./notify.js";
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
import { loginLogRoutes } from "./routes/sys-loginlog.js";
import { meetingLogRoutes } from "./routes/sys-meetinglog.js";
import { userApprovalRoutes } from "./routes/sys-user-approval.js";
import { meetingAppRoutes } from "./routes/meeting-applications.js";
import { meetingGroupRoutes } from "./routes/meeting-groups.js";
import { caCertRoutes } from "./routes/ca-cert.js";
import { getConfigInt } from "./config-cache.js";
import { isForceChangePassword } from "./auth.js";
import { loadSessionUser } from "./session-user.js";
import { registerOperLogHook } from "./middleware/oper-log.js";
import { cleanupExpiredLogs } from "./routes/sys-operlog.js";
import { ZodError } from "zod";
import { assertProductionCryptoKey } from "./crypto-guard.js";

// 生产环境必须显式配置密码传输加密密钥（缺失/占位值时拒绝启动，详见 crypto-guard.ts）
assertProductionCryptoKey();

// forceCloseConnections：docker stop 时 Fastify 的 app.close() 会等待 keep-alive
// 空闲连接（浏览器/健康检查留下的）直到宽限超时，实测卡满 stop_grace_period 30s；
// 开启后 close 前先断开空闲连接，停机从 30s 降到 <2s。
// trustProxy：经反向代理（Caddy / compose 网关）时 req.ip 取 X-Forwarded-For 末段
// 真实客户端 IP，用于 IP 级限流；仅信任内网/回环/链路本地上的代理，公网直连
// 客户端无法伪造 XFF。
const app = Fastify({
  logger: true,
  forceCloseConnections: true,
  trustProxy: ["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"],
});
const db = await createPool();
const redis = createRedis();

// 初始化站内通知：Redis 可用则启用跨实例 pub/sub，否则进程内模式
initNotify(redis);

// 启动时自动执行数据库迁移（幂等，可重复执行）
try {
  const n = await migrate(db);
  app.log.info({ migrations: n }, "database migration completed");
} catch (err) {
  app.log.error({ err }, "database migration failed");
  throw err;
}

// ── 全局错误处理器 ──
// ZodError → 400 validation_error（原行为保持）；
// 5xx：记服务端日志，对客户端只回通用 internal_error——
//   原实现直接 reply.send(err)，会把 err.message（可能含 SQL 语句/驱动内部
//   细节/文件路径）序列化后发给客户端，属信息泄露；
// 4xx：业务错误的 message 为受控文案（路由显式构造），保持透传以不破坏
//   前端 errors.<code> 映射。
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
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
  if (statusCode >= 500) {
    req.log.error({ err }, "unhandled server error");
    return reply.code(500).send({ error: "internal_error" });
  }
  return reply
    .code(statusCode)
    .send({ error: (err as { message?: string }).message ?? "error" });
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

// ── 管理面会话统一挂载（req.appUser 惯例）──
// /sys- 与 /api/sys- 前缀的请求在此加载一次会话并挂到 req，供路由与
// oper-log 日志钩子复用，消除「路由内一次 + onResponse 再一次」的重复
// RBAC 查询。路由侧后续可逐路由迁移到 req.appUser（P3），迁移一个少一次查询。
// 失败不阻断：路由内的 loadSessionUser 仍各自做权威鉴权。
app.addHook("preHandler", async (req) => {
  const url = req.url;
  if (!url.startsWith("/sys-") && !url.startsWith("/api/sys-")) return;
  const sid = req.headers["x-session-id"] as string | undefined;
  if (!sid) return;
  try {
    const user = await loadSessionUser(db, redis, sid);
    if (user) {
      (req as unknown as { appUser?: { username: string } }).appUser = user;
    }
  } catch {
    /* 挂载失败不影响请求：路由内仍有权威鉴权 */
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
await loginLogRoutes(app, db, redis);
await meetingLogRoutes(app, db, redis);
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
    await closeNotify();
  } catch {
    /* 关闭失败不影响退出 */
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
