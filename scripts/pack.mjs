#!/usr/bin/env node
/**
 * Local pack: build all packages and mirror artifacts under repo-root dist/.
 * Docker deploy does not require this; use npm run pack:docker for image tarballs.
 */
import { cpSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function copyDir(src, dest) {
  if (!existsSync(src)) {
    console.error(`missing build output: ${src}`);
    process.exit(1);
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

console.log("→ build shared + db + api + realtime + front");
run("npm", ["run", "build:shared"]);
run("npm", ["run", "build", "-w", "@meeting/api"]);
run("npm", ["run", "build", "-w", "@meeting/realtime"]);
run("npm", ["run", "build", "-w", "@meeting/front"]);

console.log("→ copy into dist/");
copyDir(join(root, "serve/shared/dist"), join(out, "shared"));
copyDir(join(root, "serve/db/dist"), join(out, "db"));
copyDir(join(root, "serve/api/dist"), join(out, "api"));
copyDir(join(root, "serve/api/src/sql"), join(out, "api/sql"));
copyDir(join(root, "serve/realtime/dist"), join(out, "realtime"));
copyDir(join(root, "front/dist"), join(out, "front"));

mkdirSync(join(out, "deploy"), { recursive: true });
// compose 已合并为单一 docker-compose.yml（profiles 控制数据库，
// 不再有 docker-compose.prod.yml / docker-compose.postgres.yml）
for (const f of [
  "docker-compose.yml",
  "Caddyfile",
  ".env.production.example",
]) {
  cpSync(join(root, f), join(out, "deploy", f === ".env.production.example" ? "env.example" : f));
}

writeFileSync(
  join(out, "README.txt"),
  [
    "Meeting pack output",
    "",
    "front/     — static web (nginx / Caddy)",
    "api/       — API JS + sql/ (Node)",
    "realtime/  — signaling + mediasoup JS",
    "shared/    — shared types runtime",
    "db/        — DB adapter runtime",
    "deploy/    — compose / Caddy / env example for Docker deploy",
    "",
    "Recommended production path: Docker (see docs/production-docker.md).",
    "  npm run pack:docker   → dist/docker/*.tar",
    "",
  ].join("\n"),
);

console.log(`✓ packed → ${out}`);
