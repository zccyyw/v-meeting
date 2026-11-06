#!/usr/bin/env node
/**
 * Interactive configuration tool for Meet (no shell scripts needed).
 * Run with: node configure.mjs
 *
 * Features:
 *   - Generate .env from template with interactive prompts
 *   - Generate self-signed TLS certificate
 *   - Run database migration and seed
 *   - Restart systemd services
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";
import { randomBytes } from "node:crypto";
import { spawnSync, execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = path.resolve(__dirname, "..");
const CONF_DIR = path.join(PREFIX, "conf");
const ENV_FILE = path.join(CONF_DIR, ".env");
const ENV_EXAMPLE = path.join(CONF_DIR, "env.example");
const CERT_DIR = path.join(PREFIX, "certs");
const DATA_DIR = path.join(PREFIX, "data");
const LOGS_DIR = path.join(PREFIX, "logs");

// Locate node binary (prefer bundled runtime)
const NODE_BIN = fs.existsSync(path.join(PREFIX, "runtime/bin/node"))
  ? path.join(PREFIX, "runtime/bin/node")
  : process.execPath;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue) {
  return new Promise((resolve) => {
    const prompt = defaultValue ? `${question} [${defaultValue}]: ` : `${question}: `;
    rl.question(prompt, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function log(msg) {
  console.log(`[configure] ${msg}`);
}

function fail(msg) {
  console.error(`[configure] ERROR: ${msg}`);
  process.exit(1);
}

function runNode(cwd, ...args) {
  // 与 install.sh 的 run_node 一致：用 --env-file 把 conf/.env 交给子进程。
  // 此前只传 {...process.env}，而 .env 从未被加载，migrate/seed 一直用默认凭据
  // 连接（改过库名或口令就会连错库），是 "Unknown database" 的另一半原因。
  const nodeArgs = fs.existsSync(ENV_FILE)
    ? [`--env-file=${ENV_FILE}`, ...args]
    : args;
  const r = spawnSync(NODE_BIN, nodeArgs, {
    cwd,
    stdio: "inherit",
    env: { ...process.env },
  });
  if (r.status !== 0) fail(`command failed: node ${args.join(" ")}`);
}

function ensureDirs() {
  for (const dir of [CONF_DIR, CERT_DIR, DATA_DIR, LOGS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadEnvTemplate() {
  if (!fs.existsSync(ENV_EXAMPLE)) {
    // Fallback: generate a minimal template（与发布包默认一致：MySQL）
    return `# Meet configuration
DB_DRIVER=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=meeting
MYSQL_PASSWORD=meetingpass
MYSQL_DATABASE=meeting
REDIS_HOST=memory
API_PORT=8080
WS_PORT=8082
GATEWAY_PORT=443
VITE_APP_NAME=Meeting
MEDIASOUP_ANNOUNCED_IP=127.0.0.1
MEDIASOUP_LISTEN_IP=0.0.0.0
RTC_MIN_PORT=40000
RTC_MAX_PORT=41000
`;
  }
  return fs.readFileSync(ENV_EXAMPLE, "utf8");
}

async function main() {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║     Meet Configuration Wizard        ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");

  ensureDirs();

  // --- Check existing config ---
  const hasExisting = fs.existsSync(ENV_FILE);
  if (hasExisting) {
    log(`Found existing config: ${ENV_FILE}`);
    const overwrite = await ask("Overwrite? (y/N)", "N");
    if (overwrite.toLowerCase() !== "y") {
      log("Keeping existing config.");
    } else {
      await generateConfig();
    }
  } else {
    await generateConfig();
  }

  // --- Certificate ---
  const envContent = fs.readFileSync(ENV_FILE, "utf8");
  const hasCert = fs.existsSync(path.join(CERT_DIR, "fullchain.pem"));
  if (!hasCert) {
    console.log("");
    const genCert = await ask("Generate self-signed TLS certificate? (Y/n)", "Y");
    if (genCert.toLowerCase() !== "n") {
      const ipMatch = envContent.match(/MEDIASOUP_ANNOUNCED_IP=(.+)/);
      const ip = ipMatch ? ipMatch[1].trim() : await ask("Enter server IP or domain");
      if (ip) {
        log(`Generating certificate for ${ip}...`);
        runNode(__dirname, "gen-cert.mjs", ip, CERT_DIR);
      }
    }
  } else {
    log("Certificate already exists, skipping.");
  }

  // --- Database readiness (自动建库 + 连通性) ---
  console.log("");
  loadEnvIntoProcess();
  if (!(await checkDatabase())) {
    console.log("");
    log("数据库未就绪：已跳过迁移与默认用户初始化。");
    log(`配置已保存到 ${ENV_FILE}，按上面的提示处理后再执行一次本向导即可（无需重填）。`);
    rl.close();
    return;
  }

  // --- Database migration ---
  console.log("");
  const runMigrate = await ask("Run database migration now? (Y/n)", "Y");
  if (runMigrate.toLowerCase() !== "n") {
    log("Running migration...");
    runNode(path.join(PREFIX, "app/serve/api"), "dist/migrate.js");
  }

  // --- Seed default users ---
  const runSeed = await ask("Seed default users (admin/123456, test1-5/123456)? (Y/n)", "Y");
  if (runSeed.toLowerCase() !== "n") {
    log("Seeding default users...");
    runNode(path.join(PREFIX, "app/serve/api"), "dist/seed-admin.js");
  }

  // --- Restart services ---
  console.log("");
  const restartSvc = await ask("Restart systemd services? (Y/n)", "Y");
  if (restartSvc.toLowerCase() !== "n") {
    try {
      execSync("systemctl daemon-reload", { stdio: "inherit" });
      execSync("systemctl restart meeting-api meeting-realtime meeting-gateway", { stdio: "inherit" });
      log("Services restarted.");
    } catch {
      log("systemctl not available. Use 'node bin/start-all.mjs' to start manually.");
    }
  }

  console.log("");
  log("Configuration complete!");
  log(`  Config: ${ENV_FILE}`);
  log(`  Data:   ${DATA_DIR}`);
  log(`  Logs:   ${LOGS_DIR}`);
  const portMatch = envContent.match(/GATEWAY_PORT=(\d+)/);
  const port = portMatch ? portMatch[1] : "443";
  const hasCertNow = fs.existsSync(path.join(CERT_DIR, "fullchain.pem"));
  const proto = hasCertNow ? "https" : "http";
  log(`  Access: ${proto}://<server-ip>:${port}/`);
  log(`  Login:  admin / 123456  (超级管理员)`);
  log(`          test1-5 / 123456    (普通用户)`);

  rl.close();
}

/**
 * 把 conf/.env 注入当前进程环境。
 * configure 自身与它 fork 的 migrate/seed 子进程都只读 process.env，不读 .env，
 * 所以必须在跑迁移前注入，否则子进程会拿默认凭据连错库。
 */
function loadEnvIntoProcess() {
  if (!fs.existsSync(ENV_FILE)) return;
  for (const raw of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    // 不覆盖已存在的环境变量，便于用环境变量临时覆盖配置
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * 确保数据库存在且可连接。
 * 建库逻辑不在本文件重复实现，而是复用 app/serve/db 的 createPool：它在建池前
 * 会 CREATE DATABASE IF NOT EXISTS，账号无建库权限时只告警不中断。因此这里既能
 * 自动建库，也不会把"库已存在但只有库级权限"的正常环境误判为失败。
 */
async function checkDatabase() {
  const driver = (process.env.DB_DRIVER ?? "sqlite").trim().toLowerCase();
  if (driver === "sqlite") {
    log("SQLite 无需建库，跳过数据库检查。");
    return true;
  }

  const dbEntry = path.join(PREFIX, "app/serve/db/dist/index.js");
  if (!fs.existsSync(dbEntry)) {
    log(`未找到 ${dbEntry}，跳过建库检查（迁移仍会尝试连接）。`);
    return true;
  }

  const isPg = driver === "postgres";
  const dbName = isPg
    ? process.env.PGDATABASE ?? process.env.POSTGRES_DATABASE ?? "meeting"
    : process.env.MYSQL_DATABASE ?? "meeting";
  const dbUser = isPg
    ? process.env.PGUSER ?? process.env.POSTGRES_USER ?? "meeting"
    : process.env.MYSQL_USER ?? "meeting";

  let db;
  try {
    const mod = await import(pathToFileURL(dbEntry).href);
    db = await mod.createPool();
    // createPool 是惰性建连，必须真跑一条语句才能验证库是否存在/可达
    await db.query("SELECT 1");
    log(`数据库就绪：${driver} / ${dbName}`);
    return true;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? String(err.code) : "";
    const msg = err instanceof Error ? err.message : String(err);
    console.error("");
    console.error(`[configure] 数据库连接失败：${msg}`);
    if (code === "ER_BAD_DB_ERROR" || code === "3D000") {
      console.error(`[configure] 库 "${dbName}" 不存在，且当前账号没有建库权限。请用 DBA 账号执行：`);
      if (isPg) {
        console.error(`  CREATE DATABASE "${dbName}";`);
      } else {
        console.error(`  CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4;`);
        console.error(`  CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '<你的口令>';`);
        console.error(`  GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'%';`);
        console.error("  FLUSH PRIVILEGES;");
      }
    } else if (code === "ER_ACCESS_DENIED_ERROR" || code === "28P01") {
      console.error("[configure] 账号或口令不正确，请核对 conf/.env 中的连接配置。");
    } else if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT") {
      console.error("[configure] 数据库服务不可达，请确认已启动且地址/端口正确。");
    }
    return false;
  } finally {
    if (db) await db.end().catch(() => {});
  }
}

async function generateConfig() {
  let template = loadEnvTemplate();

  console.log("");
  console.log("--- Database Configuration ---");
  const dbDriver = await ask("Database driver (mysql/sqlite/postgres)", "mysql");

  let config = {};

  if (dbDriver === "sqlite") {
    config.SQLITE_PATH = await ask("SQLite file path", `${DATA_DIR}/meeting.sqlite`);
  } else if (dbDriver === "mysql") {
    config.MYSQL_HOST = await ask("MySQL host", "127.0.0.1");
    config.MYSQL_PORT = await ask("MySQL port", "3306");
    config.MYSQL_USER = await ask("MySQL user", "meeting");
    config.MYSQL_PASSWORD = await ask("MySQL password", "meetingpass");
    config.MYSQL_DATABASE = await ask("MySQL database", "meeting");
  } else if (dbDriver === "postgres") {
    config.PGHOST = await ask("PostgreSQL host", "127.0.0.1");
    config.PGPORT = await ask("PostgreSQL port", "5432");
    config.PGUSER = await ask("PostgreSQL user", "meeting");
    config.PGPASSWORD = await ask("PostgreSQL password", "meetingpass");
    config.PGDATABASE = await ask("PostgreSQL database", "meeting");
  }

  config.DB_DRIVER = dbDriver;

  console.log("");
  console.log("--- Redis Configuration ---");
  const useRedis = await ask("Use external Redis? (y/N)", "N");
  config.REDIS_HOST = useRedis.toLowerCase() === "y"
    ? await ask("Redis host", "127.0.0.1")
    : "memory";
  if (useRedis.toLowerCase() === "y") {
    config.REDIS_PORT = await ask("Redis port", "6379");
  }

  console.log("");
  console.log("--- WebRTC Configuration ---");
  config.MEDIASOUP_ANNOUNCED_IP = await ask("Server IP (client-reachable)");

  console.log("");
  console.log("--- Ports ---");
  config.API_PORT = await ask("API port", "8080");
  config.WS_PORT = await ask("WebSocket port", "8082");
  config.GATEWAY_PORT = await ask("Gateway port", "443");

  // --- Security ---
  // MEETING_CRYPTO_KEY: required by the API in production (fail-fast on a
  // missing/placeholder value, see serve/api/src/crypto-guard.ts). The env
  // template ships it commented out, so auto-generate a random key here.
  // The gateway delivers it to the browser via /app-config.js at runtime,
  // so no frontend rebuild is needed.
  const existingCryptoKey =
    template.match(/^MEETING_CRYPTO_KEY=(.*)$/m)?.[1]?.trim() ?? "";
  if (!existingCryptoKey || existingCryptoKey === "change-me-crypto-key") {
    config.MEETING_CRYPTO_KEY = randomBytes(32).toString("base64");
  }

  // Build env file by replacing/adding values in template
  let env = template;

  // Always ensure essential keys exist
  const essentialKeys = [
    "DB_DRIVER", "MEDIASOUP_ANNOUNCED_IP", "MEDIASOUP_LISTEN_IP",
    "RTC_MIN_PORT", "RTC_MAX_PORT", "API_PORT", "WS_PORT", "GATEWAY_PORT",
    "REDIS_HOST",
  ];

  // Set MEDIASOUP_LISTEN_IP and RTC ports to defaults if missing
  if (!config.MEDIASOUP_LISTEN_IP) config.MEDIASOUP_LISTEN_IP = "0.0.0.0";
  if (!config.RTC_MIN_PORT) config.RTC_MIN_PORT = "40000";
  if (!config.RTC_MAX_PORT) config.RTC_MAX_PORT = "41000";

  for (const [key, value] of Object.entries(config)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(env)) {
      env = env.replace(regex, `${key}=${value}`);
    } else {
      env += `${key}=${value}\n`;
    }
  }

  fs.writeFileSync(ENV_FILE, env, { mode: 0o600 });
  log(`Config written to ${ENV_FILE}`);
}

main().catch((err) => {
  console.error("[configure] Fatal:", err);
  rl.close();
  process.exit(1);
});
