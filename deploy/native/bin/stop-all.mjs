#!/usr/bin/env node
/**
 * Stop all Meeting services (no shell scripts needed).
 * Reads PID files and sends SIGTERM.
 *
 * Usage: node stop-all.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kill } from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, "../logs");

for (const name of ["api", "realtime", "gateway"]) {
  const pidFile = path.join(LOGS_DIR, `${name}.pid`);
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
    if (pid) {
      try {
        kill(pid);
        console.log(`[stop] ${name} stopped (pid=${pid})`);
      } catch {
        console.log(`[stop] ${name} not running (pid=${pid})`);
      }
    }
    fs.unlinkSync(pidFile);
  } else {
    console.log(`[stop] ${name} no pid file, skipping`);
  }
}
