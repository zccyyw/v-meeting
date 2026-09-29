#!/usr/bin/env node
/**
 * Build production Docker images and pack a self-contained offline bundle.
 *
 * Env:
 *   IMAGE_TAG          default latest
 *   DOCKER_PLATFORM    e.g. linux/amd64 | linux/arm64 (optional)
 *   VITE_API_BASE / VITE_WS_URL / VITE_APP_NAME / VITE_APP_LOGO  front build args
 */
import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "docker");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    ...opts,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const images = [
  { name: "meeting-api", dockerfile: "serve/api/Dockerfile" },
  { name: "meeting-realtime", dockerfile: "serve/realtime/Dockerfile" },
  { name: "meeting-web", dockerfile: "front/Dockerfile" },
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const tag = process.env.IMAGE_TAG || "latest";
const platform = (process.env.DOCKER_PLATFORM || "").trim();
// 产物命名：显式平台取平台名（linux/arm64 -> arm64）；未指定时取宿主架构
// （x64 构建机 -> x64），避免出现不自解释的 "host"，并与 arm64 命名风格一致。
const platformSlug = platform
  ? platform.replace("linux/", "").replace("/", "-")
  : process.arch === "arm64"
    ? "arm64"
    : "x64";
const built = [];

console.log(
  platform
    ? `-> docker build (platform=${platform})`
    : "-> docker build (host platform; set DOCKER_PLATFORM=linux/arm64 for ARM images)",
);

for (const img of images) {
  const ref = `${img.name}:${tag}`;
  console.log(`-> ${ref}`);
  const args = ["build", "-f", img.dockerfile, "-t", ref];
  if (platform) {
    args.push("--platform", platform);
  }
  if (img.name === "meeting-web") {
    args.push(
      "--build-arg",
      `VITE_API_BASE=${process.env.VITE_API_BASE || "/api"}`,
      "--build-arg",
      `VITE_WS_URL=${process.env.VITE_WS_URL || "auto"}`,
      "--build-arg",
      `VITE_APP_NAME=${process.env.VITE_APP_NAME || "Meeting"}`,
      "--build-arg",
      `VITE_APP_LOGO=${process.env.VITE_APP_LOGO || "/favicon.svg"}`,
      "--build-arg",
      `VITE_PWA_ENABLED=${process.env.VITE_PWA_ENABLED ?? "0"}`,
    );
  }
  if (img.name === "meeting-realtime") {
    // mediasoup worker 构建网络参数透传：国内构建机用
    // PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
    // GHPROXY=https://gh-proxy.com（默认已是）
    args.push(
      "--build-arg",
      `PIP_INDEX_URL=${process.env.PIP_INDEX_URL || "https://pypi.org/simple"}`,
      "--build-arg",
      `GHPROXY=${process.env.GHPROXY || "https://gh-proxy.com"}`,
    );
  }
  args.push(".");
  run("docker", args);
  built.push(ref);
}

// 应用镜像打包
// CI 构建时 IMAGE_TAG 为版本号（如 0.0.10），而 docker-compose.yml 默认引用
// :latest——若产物只有版本 tag，load 后 compose 找不到镜像会转而 build，
// 离线包无源码目录必然失败。因此 save 前统一补打 :latest tag。
const saveRefs = [];
if (tag !== "latest") {
  for (const ref of built) {
    const latestRef = `${ref.split(":")[0]}:latest`;
    run("docker", ["tag", ref, latestRef]);
    saveRefs.push(ref, latestRef);
  }
} else {
  saveRefs.push(...built);
}
const appTar = `meeting-app-${platformSlug}-${tag}.tar`;
console.log(`-> docker save ${appTar}`);
run("docker", ["save", "-o", join(out, appTar), ...saveRefs]);

// 基础镜像打包（离线环境无法 pull）
const baseImages = [
  "postgres:12-alpine",
  "mysql:8.4",
  "redis:7-alpine",
  "caddy:2-alpine",
];
console.log(`-> docker pull & save base images`);
for (const base of baseImages) {
  if (platform) {
    run("docker", ["pull", "--platform", platform, base]);
  } else {
    run("docker", ["pull", base]);
  }
}
const baseTar = `meeting-base-${platformSlug}-${tag}.tar`;
run("docker", ["save", "-o", join(out, baseTar), ...baseImages]);

// 复制 compose 编排文件并生成为离线版：剥离所有 build: 段后写回
// docker-compose.yml，使离线包内仅保留单一 docker-compose.yml，
// 离线执行 `docker-compose up` 不会误触发在线构建（离线包无源码目录必失败）。
// 仅离线一种部署方式，不再提供含 build 段的在线 compose。
const composeSrcPath = join(root, "docker-compose.yml");
if (existsSync(composeSrcPath)) {
  const composeSrc = readFileSync(composeSrcPath, "utf8");
  const offlineCompose = composeSrc.replace(
    /^[ \t]*build:[^\n]*\n(?:^[ \t]{6,}[^\n]*\n)*/gm,
    "",
  );
  writeFileSync(join(out, "docker-compose.yml"), offlineCompose);
}

// Caddyfile 与 .env 模板
if (existsSync(join(root, "Caddyfile"))) {
  copyFileSync(join(root, "Caddyfile"), join(out, "Caddyfile"));
}
// 注意：命名为 env.example（不带前导点）——以点开头的隐藏文件在
// scp 通配符拷贝 / 部分解压工具 / 文件管理器中容易被漏掉，导致
// 用户在目标机找不到环境模板。
copyFileSync(
  join(root, ".env.production.example"),
  join(out, "env.example"),
);

// 证书目录占位
mkdirSync(join(out, "deploy", "docker", "certs"), { recursive: true });
writeFileSync(
  join(out, "deploy", "docker", "certs", "README.txt"),
  "将 fullchain.pem 与 privkey.pem 放入本目录，或运行 gen-selfsigned.sh 生成自签证书。\n",
);

// 证书生成脚本
if (existsSync(join(root, "deploy", "docker", "gen-selfsigned.sh"))) {
  mkdirSync(join(out, "deploy", "docker"), { recursive: true });
  copyFileSync(
    join(root, "deploy", "docker", "gen-selfsigned.sh"),
    join(out, "deploy", "docker", "gen-selfsigned.sh"),
  );
}

// 一键部署脚本：加载镜像(按需) + 自动生成 .env（随机密钥/口令）+ docker compose 启停统一入口
if (existsSync(join(root, "deploy", "docker", "install.sh"))) {
  copyFileSync(
    join(root, "deploy", "docker", "install.sh"),
    join(out, "install.sh"),
  );
}

// 离线包说明
writeFileSync(
  join(out, "README.txt"),
  [
    `Meeting Docker 离线包`,
    `tag=${tag}`,
    `platform=${platform || "host"}`,
    "",
    `应用镜像 (in ${appTar}):`,
    ...built.map((b) => `  - ${b}`),
    "",
    `基础镜像 (in ${baseTar}):`,
    ...baseImages.map((b) => `  - ${b}`),
    "",
    "部署步骤：",
    "  1. bash install.sh                  # 一键部署：自动加载镜像(已加载则跳过) + 生成 .env",
    "                                      #   （随机 MEETING_CRYPTO_KEY 与数据库/Redis 口令、",
    "                                      #    探测 ANNOUNCED_IP；已有配置保留）并 docker compose up -d",
    "  2. bash deploy/docker/gen-selfsigned.sh --ca <服务器IP>  # 生成证书（443 HTTPS 需），",
    "     然后 bash install.sh 重启使 caddy 挂载新证书",
    "",
    "手工等价：cp env.example .env && vi .env（改 MEDIASOUP_ANNOUNCED_IP 与 MYSQL_* 口令）",
    "          && docker-compose -p meeting up -d",
    "",
    "默认数据库 MySQL：会启动 mysql:8.4 容器（口令由 install.sh 自动生成，可自行修改）",
    "改用零依赖单机：.env 设 COMPOSE_PROFILES=sqlite（数据存于 meeting-data volume）；亦可设 postgres",
    "",
    "停止：bash install.sh stop        # docker compose stop（数据保留）",
    "卸载：bash install.sh down        # docker compose down（数据卷保留）",
    "      bash install.sh down -v     # 连数据卷一起删除（清空数据库/录制）",
    "升级：备份 meeting-data 卷后，替换镜像 tar 再 bash install.sh（API 启动自动迁移）",
    "",
    `Docs: docs/install/本地部署说明-docker.md`,
    "",
  ].join("\n"),
);

writeFileSync(join(out, "PLATFORM.txt"), `${platform || "host"}\n`);
console.log(`✓ docker pack -> ${out}/`);
console.log(`  - ${appTar}`);
console.log(`  - ${baseTar}`);
console.log(`  - compose 文件与 install.sh（一键部署入口）`);
