#!/usr/bin/env node
/**
 * Build production Docker images and pack a self-contained offline bundle.
 *
 * Env:
 *   IMAGE_TAG          default latest
 *   DOCKER_PLATFORM    e.g. linux/amd64 | linux/arm64 (optional)
 *   VITE_API_BASE / VITE_WS_URL / VITE_APP_NAME / VITE_APP_LOGO  front build args
 */
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  cpSync,
  chmodSync,
  createWriteStream,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import archiver from "archiver";

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

/**
 * 拷贝文本文件并归一换行符为 LF。
 * Windows 开发机工作区可能持有 CRLF（无 .gitattributes 历史或 autocrlf 开启），
 * 直接拷贝会把 CRLF 带进离线包 / Docker 构建上下文，Linux 上执行 shell
 * 脚本即 "bad interpreter: /bin/bash^M"。
 */
function copyTextLf(src, dest) {
  const text = readFileSync(src, "utf8").replace(/\r\n/g, "\n");
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, text);
}

const images = [
  { name: "meeting-api", dockerfile: "serve/api/Dockerfile" },
  { name: "meeting-realtime", dockerfile: "serve/realtime/Dockerfile" },
  { name: "meeting-web", dockerfile: "front/Dockerfile" },
];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// 前置校验：fail fast，避免构建到最后一步才失败
run("docker", ["info", "--format", "{{.ServerVersion}}"]);
for (const f of ["docker-compose.yml", ".env.production.example"]) {
  if (!existsSync(join(root, f))) {
    console.error(`✗ 缺少 ${f}，请在仓库根目录运行`);
    process.exit(1);
  }
}

// 版本号：显式 IMAGE_TAG 优先；否则取最近 git tag（去 v 前缀）对齐 CI 产物命名；
// 无 tag（如首次打包）回退 latest
const explicitTag = (process.env.IMAGE_TAG || "").trim();
let tag = explicitTag || "latest";
if (!explicitTag) {
  const g = spawnSync("git", ["describe", "--tags", "--abbrev=0"], {
    cwd: root,
    encoding: "utf8",
  });
  const t = (g.stdout || "").trim();
  if (g.status === 0 && t) tag = t.replace(/^v/, "");
}
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

// 基础镜像清单：从 docker-compose.yml 解析（唯一事实源）。
// 曾因 compose 将 redis/caddy 钉 minor（7-alpine→7.4-alpine、2-alpine→2.11-alpine）
// 而此处硬编码未同步，导致离线包 load 后 compose 匹配不到 tag、转而联网拉取
// （阿里云/内网环境必然超时）。此后 compose 改 tag 离线包自动跟随，杜绝漂移。
// 排除带 ${VAR} 的引用：meeting-api/realtime/web 为本仓库 build 产物，
// 不在基础镜像范畴。
function resolveBaseImages(composePath) {
  const content = readFileSync(composePath, "utf8");
  const refs = [...content.matchAll(/^[ \t]*image:[ \t]*(\S+)[ \t]*$/gm)].map((m) => m[1]);
  const external = [...new Set(refs.filter((r) => !r.includes("${")))];
  if (external.length === 0) {
    console.error(`✗ 未能从 ${composePath} 解析到任何基础镜像（image: 行），请检查 compose 文件格式`);
    process.exit(1);
  }
  return external;
}
const baseImages = resolveBaseImages(join(root, "docker-compose.yml"));
console.log("-> 基础镜像：本地已存在且架构匹配则复用，否则拉取（FORCE_PULL=1 强制重拉）");
// 目标架构：DOCKER_PLATFORM 指定时取其平台；未指定时与镜像构建一致（宿主引擎架构）
const targetArch = platform
  ? platform.split("/")[1]
  : process.arch === "arm64"
    ? "arm64"
    : "amd64";
for (const base of baseImages) {
  // 本地命中判定：镜像存在且 Architecture 与目标一致 → 跳过 pull。
  // 每次 pull 在内网/弱网环境可能耗时数分钟，本地镜像可复用时无需重复下载。
  let needPull = process.env.FORCE_PULL === "1";
  if (!needPull) {
    const inspect = spawnSync("docker", ["image", "inspect", base], { encoding: "utf8" });
    if (inspect.status !== 0) {
      console.log(`   ${base}: 本地不存在，拉取`);
      needPull = true;
    } else {
      try {
        const localArch = JSON.parse(inspect.stdout)[0]?.Architecture ?? "";
        if (localArch !== targetArch) {
          console.log(`   ${base}: 本地架构 ${localArch} ≠ 目标 ${targetArch}，重新拉取`);
          needPull = true;
        } else {
          console.log(`   ${base}: 复用本地镜像（arch=${localArch}）`);
        }
      } catch {
        needPull = true; // inspect 输出异常，按不存在处理
      }
    }
  } else {
    console.log(`   ${base}: FORCE_PULL=1，强制拉取`);
  }
  if (!needPull) continue;
  const args = ["pull"];
  if (platform) args.push("--platform", platform);
  args.push(base);
  run("docker", args);
}
const baseTar = `meeting-base-${platformSlug}-${tag}.tar`;
run("docker", ["save", "-o", join(out, baseTar), ...baseImages]);

// 复制 compose 编排文件并生成为离线版：剥离所有 build: 段后写回
// docker-compose.yml，使离线包内仅保留单一 docker-compose.yml，
// 离线执行 `docker-compose up` 不会误触发在线构建（离线包无源码目录必失败）。
// 仅离线一种部署方式，不再提供含 build 段的在线 compose。
// 拷贝同时归一换行符为 LF（见 copyTextLf）。
const composeSrcPath = join(root, "docker-compose.yml");
if (existsSync(composeSrcPath)) {
  const composeSrc = readFileSync(composeSrcPath, "utf8");
  const offlineCompose = composeSrc.replace(
    /^[ \t]*build:[^\n]*\n(?:^[ \t]{6,}[^\n]*\n)*/gm,
    "",
  );
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "docker-compose.yml"), offlineCompose.replace(/\r\n/g, "\n"));
}

// Caddyfile 与 .env 模板（LF 归一）
if (existsSync(join(root, "Caddyfile"))) {
  copyTextLf(join(root, "Caddyfile"), join(out, "Caddyfile"));
}
// 注意：命名为 env.example（不带前导点）——以点开头的隐藏文件在
// scp 通配符拷贝 / 部分解压工具 / 文件管理器中容易被漏掉，导致
// 用户在目标机找不到环境模板。
copyTextLf(
  join(root, ".env.production.example"),
  join(out, "env.example"),
);

// 证书目录占位
mkdirSync(join(out, "deploy", "docker", "certs"), { recursive: true });
writeFileSync(
  join(out, "deploy", "docker", "certs", "README.txt"),
  "将 fullchain.pem 与 privkey.pem 放入本目录，或运行 gen-selfsigned.sh 生成自签证书。\n",
);

// 证书生成脚本（LF 归一）
if (existsSync(join(root, "deploy", "docker", "gen-selfsigned.sh"))) {
  mkdirSync(join(out, "deploy", "docker"), { recursive: true });
  copyTextLf(
    join(root, "deploy", "docker", "gen-selfsigned.sh"),
    join(out, "deploy", "docker", "gen-selfsigned.sh"),
  );
}

// 一键部署脚本：加载镜像(按需) + 自动生成 .env（随机密钥/口令）+ docker-compose 启停统一入口
if (existsSync(join(root, "deploy", "docker", "install.sh"))) {
  copyTextLf(
    join(root, "deploy", "docker", "install.sh"),
    join(out, "install.sh"),
  );
}

// 仅对两个可执行脚本授 755（zip 在 Linux 上解压后保留该权限位）；
// 其余文件保持默认权限，不需要也不应整体放权
chmodSync(join(out, "install.sh"), 0o755);
chmodSync(join(out, "deploy", "docker", "gen-selfsigned.sh"), 0o755);

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
    "                                      #    探测 ANNOUNCED_IP；已有配置保留）并 docker-compose up -d",
    "  2. bash deploy/docker/gen-selfsigned.sh --ca <服务器IP>  # 生成证书（443 HTTPS 需），",
    "     然后 bash install.sh 重启使 caddy 挂载新证书",
    "",
    "手工等价：cp env.example .env && vi .env（改 MEDIASOUP_ANNOUNCED_IP 与 MYSQL_* 口令）",
    "          && docker-compose -p meeting up -d",
    "",
    "默认数据库 MySQL：会启动 mysql:8.4 容器（口令由 install.sh 自动生成，可自行修改）",
    "改用零依赖单机：.env 设 COMPOSE_PROFILES=sqlite（数据存于 meeting-data volume）；亦可设 postgres",
    "",
    "停止：bash install.sh stop        # docker-compose stop（数据保留）",
    "卸载：bash install.sh down        # docker-compose down（数据卷保留）",
    "      bash install.sh down -v     # 连数据卷一起删除（清空数据库/录制）",
    "升级：备份 meeting-data 卷后，替换镜像 tar 再 bash install.sh（API 启动自动迁移）",
    "",
    `Docs: docs/install/本地部署说明-docker.md`,
    "",
  ].join("\n"),
);

writeFileSync(join(out, "PLATFORM.txt"), `${platform || "host"}\n`);

// 一键 zip（archiver 显式写入 Unix 权限位）：目录 755、install.sh / gen-selfsigned.sh
// 755、其余文件 644——Linux 解压（unzip）原样还原权限，避免"无权限元数据 → 解压端按
// umask 合成 777/666"。命名与 CI Release 资产一致；PACK_ZIP=0 跳过。
const wantZip = (process.env.PACK_ZIP ?? "1") !== "0";
if (wantZip) {
  const zipName = `meeting-docker-${platformSlug}-${tag}`;
  const zipPath = join(root, "dist", `${zipName}.zip`);
  rmSync(zipPath, { force: true });
  await zipOut(out, zipPath, zipName);
  console.log(`✓ zip -> ${zipPath}`);
}

/** 递归打包 srcRoot 到 zipPath，顶层目录名为 topDirName；权限显式指定（见上） */
async function zipOut(srcRoot, zipPath, topDirName) {
  // 可执行脚本白名单：命中授 755，其余文件 644
  const SCRIPT_NAMES = new Set(["install.sh", "gen-selfsigned.sh"]);
  const output = createWriteStream(zipPath);
  const archive = archiver("zip", { forceLocalTime: true });
  const done = new Promise((resolve, reject) => {
    output.on("close", () => resolve());
    archive.on("error", reject);
    output.on("error", reject);
  });
  archive.pipe(output);
  const walk = (absDir, relDir) => {
    archive.append(null, { name: `${relDir}/`, type: "directory", mode: 0o755 });
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(absDir, entry.name), rel);
      } else {
        const mode = SCRIPT_NAMES.has(entry.name) ? 0o755 : 0o644;
        archive.file(join(absDir, entry.name), { name: rel, mode });
      }
    }
  };
  walk(srcRoot, topDirName);
  await archive.finalize();
  await done;
}

console.log(`✓ docker pack -> ${out}/`);
console.log(`  - ${appTar}`);
console.log(`  - ${baseTar}`);
console.log(`  - compose 文件与 install.sh（一键部署入口）`);
