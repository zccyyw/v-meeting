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
import { fileURLToPath } from "node:url";
import readline from "node:readline";
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
  const r = spawnSync(NODE_BIN, args, {
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
    // Fallback: generate a minimal template
    return `# Meet configuration
DB_DRIVER=sqlite
SQLITE_PATH=${DATA_DIR}/meeting.sqlite
REDIS_HOST=memory
API_PORT=8080
WS_PORT=8082
GATEWAY_PORT=8088
MEDIASOUP_ANNOUNCED_IP=127.0.0.1
MEDIASOUP_LISTEN_IP=0.0.0.0
RTC_MIN_PORT=40000
RTC_MAX_PORT=40100
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

  // --- Database migration ---
  console.log("");
  const runMigrate = await ask("Run database migration now? (Y/n)", "Y");
  if (runMigrate.toLowerCase() !== "n") {
    log("Running migration...");
    runNode(path.join(PREFIX, "app/serve/api"), "dist/migrate.js");
  }

  // --- Seed default users ---
  const runSeed = await ask("Seed default users (admin/admin123, test1-5/123456)? (Y/n)", "Y");
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
  const port = portMatch ? portMatch[1] : "8088";
  const hasCertNow = fs.existsSync(path.join(CERT_DIR, "fullchain.pem"));
  const proto = hasCertNow ? "https" : "http";
  log(`  Access: ${proto}://<server-ip>:${port}/`);
  log(`  Login:  admin / admin123  (超级管理员)`);
  log(`          test1-5 / 123456    (普通用户)`);

  rl.close();
}

async function generateConfig() {
  let template = loadEnvTemplate();

  console.log("");
  console.log("--- Database Configuration ---");
  const dbDriver = await ask("Database driver (sqlite/mysql/postgres)", "sqlite");

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
  config.GATEWAY_PORT = await ask("Gateway port", "8088");

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
  if (!config.RTC_MAX_PORT) config.RTC_MAX_PORT = "40100";

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
