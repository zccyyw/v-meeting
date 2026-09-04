#!/usr/bin/env node
/**
 * Start all Meeting services manually (no shell scripts needed).
 * Starts: API, Realtime, Gateway
 *
 * Usage: node start-all.mjs
 *
 * Env: reads PREFIX/conf/.env (or ../../conf/.env relative to this script)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = path.resolve(__dirname, "..");
const ENV_FILE = path.join(PREFIX, "conf/.env");
const LOGS_DIR = path.join(PREFIX, "logs");

// Locate node binary (prefer bundled runtime)
const NODE_BIN = fs.existsSync(path.join(PREFIX, "runtime/bin/node"))
  ? path.join(PREFIX, "runtime/bin/node")
  : process.execPath;

fs.mkdirSync(LOGS_DIR, { recursive: true });

function openLog(name) {
  return fs.openSync(path.join(LOGS_DIR, `${name}.log`), "a");
}

function openErr(name) {
  return fs.openSync(path.join(LOGS_DIR, `${name}.err.log`), "a");
}

const processes = [];

function startService(name, cwd, script, env) {
  const args = [];
  if (fs.existsSync(ENV_FILE)) {
    args.push(`--env-file=${ENV_FILE}`);
  }
  args.push(script);

  const child = spawn(NODE_BIN, args, {
    cwd,
    stdio: ["ignore", openLog(name), openErr(name)],
    detached: true,
    env: { ...process.env, ...env },
  });

  child.unref();

  const pidFile = path.join(LOGS_DIR, `${name}.pid`);
  fs.writeFileSync(pidFile, String(child.pid));

  console.log(`[start] ${name} started (pid=${child.pid})`);

  child.on("error", (err) => {
    console.error(`[start] ${name} error: ${err.message}`);
  });

  processes.push({ name, child, pidFile });
}

// Start API
startService("api", path.join(PREFIX, "app/serve/api"), "dist/index.js", {
  FRONT_ROOT: path.join(PREFIX, "app/front"),
});

// Start Realtime
startService("realtime", path.join(PREFIX, "app/serve/realtime"), "dist/index.js", {});

// Start Gateway (after a short delay to let API/Realtime bind)
setTimeout(() => {
  startService("gateway", PREFIX, path.join(PREFIX, "bin/gateway.mjs"), {
    FRONT_ROOT: path.join(PREFIX, "app/front"),
    API_UPSTREAM: "http://127.0.0.1:8080",
    WS_UPSTREAM: "http://127.0.0.1:8082",
  });

  console.log("");
  console.log("[start] All services started.");
  console.log(`[start] PIDs written to ${LOGS_DIR}/*.pid`);
  console.log(`[start] Logs in ${LOGS_DIR}/*.log`);
  console.log("[start] Use 'node bin/stop-all.mjs' to stop.");
}, 1000);
