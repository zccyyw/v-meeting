#!/usr/bin/env node
/**
 * Build an offline RPM package under dist/rpm/.
 *
 * Two modes:
 *
 * 1. Docker mode (default):
 *    Uses Docker to compile native modules in a clean Linux environment.
 *    Requires Docker running and network access to pull base image.
 *
 * 2. Native mode (NO_DOCKER=1):
 *    Runs build-rpm.sh directly on the host. No Docker needed.
 *    Requires: rpmbuild (from rpm-build package) OR fpm installed.
 *    Ideal for Linux servers where Docker Hub is unreachable.
 *
 * Env:
 *   TARGET_ARCH   x64 (default) | arm64
 *   NODE_VERSION  v22.23.1 (default)
 *   RPM_VERSION   0.1 (default)
 *   RPM_RELEASE   1 (default)
 *   NO_DOCKER     Set to "1" to build natively without Docker
 *   USE_SYSTEM_NODE  Set to "1" to use system node binary (skip download)
 *
 *   # Mirror configuration (for China / restricted networks):
 *   USE_CN_MIRROR  Set to "1" to auto-configure all China mirrors
 *   BASE_IMAGE     Docker base image (default: node:22-bookworm)
 *   APT_MIRROR     apt mirror domain, e.g. mirrors.aliyun.com
 *   NPM_REGISTRY   npm registry URL, e.g. https://registry.npmmirror.com
 *   NODE_MIRROR    Node.js download mirror, e.g. https://npmmirror.com/mirrors/node
 *   GEM_MIRROR     RubyGems mirror URL, e.g. https://gems.ruby-china.com
 *
 * Usage:
 *   npm run pack:rpm
 *
 *   # Native build (no Docker, on Linux server):
 *   NO_DOCKER=1 npm run pack:rpm
 *
 *   # Native build with China mirrors + system node:
 *   NO_DOCKER=1 USE_CN_MIRROR=1 USE_SYSTEM_NODE=1 npm run pack:rpm
 *
 *   # Docker build with China mirrors:
 *   USE_CN_MIRROR=1 npm run pack:rpm
 */
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "dist", "rpm");
const arch = process.env.TARGET_ARCH === "arm64" ? "arm64" : "x64";
const rpmArch = arch === "arm64" ? "aarch64" : "x86_64";
const nodeVersion = process.env.NODE_VERSION || "v22.23.1";
const rpmVersion = process.env.RPM_VERSION || "0.1";
const rpmRelease = process.env.RPM_RELEASE || "1";
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

const builderImage = "meeting-rpm-builder";
const dockerfile = join("deploy", "rpm", "Dockerfile.build");
const buildScript = join("deploy", "rpm", "build-rpm.sh");

const noDocker = process.env.NO_DOCKER === "1";
const useSystemNode = process.env.USE_SYSTEM_NODE === "1";

// ─── Mirror configuration ───
const useCn = process.env.USE_CN_MIRROR === "1";

const baseImage =
  process.env.BASE_IMAGE ||
  (useCn
    ? "docker.m.daocloud.io/library/node:22-bookworm"
    : "node:22-bookworm");
const aptMirror = process.env.APT_MIRROR || (useCn ? "mirrors.aliyun.com" : "");
const npmRegistry =
  process.env.NPM_REGISTRY || (useCn ? "https://registry.npmmirror.com" : "");
const nodeMirror =
  process.env.NODE_MIRROR ||
  (useCn ? "https://npmmirror.com/mirrors/node" : "https://nodejs.org/dist");
const gemMirror =
  process.env.GEM_MIRROR || (useCn ? "https://gems.ruby-china.com" : "");

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: true,
    ...opts,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function checkCommand(cmd) {
  const r = spawnSync(cmd, ["--version"], { shell: true, stdio: "pipe" });
  return r.status === 0;
}

console.log(`→ pack-rpm: arch=${arch} node=${nodeVersion} version=${rpmVersion}-${rpmRelease}`);
if (noDocker) {
  console.log("→ Native build mode (NO_DOCKER=1)");
}
if (useCn) {
  console.log("→ Using China mirror configuration (USE_CN_MIRROR=1)");
}
if (useSystemNode) {
  console.log("→ Using system Node.js binary (USE_SYSTEM_NODE=1)");
}

// Clean output
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// ═══════════════════════════════════════════════════════════════
// Native mode — run build-rpm.sh directly on the host
// ═══════════════════════════════════════════════════════════════
if (noDocker) {
  // Check prerequisites — need either fpm OR rpmbuild
  const hasFpm = checkCommand("fpm");
  const hasRpmbuild = checkCommand("rpmbuild");

  if (!hasFpm && !hasRpmbuild) {
    console.error("\n✗ Neither fpm nor rpmbuild found — need at least one to build RPM.");
    console.error("\nOption A — Install rpmbuild (no network needed, from yum):");
    console.error("  yum install -y rpm-build");
    console.error("");
    console.error("Option B — Install fpm (requires Ruby + gem network):");
    console.error("  yum install -y ruby ruby-devel");
    console.error("  gem install fpm --no-document");
    process.exit(1);
  }

  if (hasFpm) {
    console.log("→ Will use fpm for RPM packaging");
  } else {
    console.log("→ fpm not found, will use rpmbuild for RPM packaging");
  }

  // Check build toolchain (needed for mediasoup & better-sqlite3 compilation)
  const buildTools = ["python3", "make", "g++", "cmake"];
  const missingTools = buildTools.filter((t) => !checkCommand(t));
  // Check pip specifically (python3 -m pip)
  const hasPip = spawnSync("python3", ["-m", "pip", "--version"], {
    shell: true,
    stdio: "pipe",
  }).status === 0;
  if (!hasPip) missingTools.push("python3-pip");

  if (missingTools.length > 0) {
    console.error("\n✗ Missing build tools: " + missingTools.join(", "));
    console.error("  mediasoup and better-sqlite3 need these to compile native code.");
    console.error("\n  Install them:");
    console.error("    yum install -y python3 python3-pip make gcc-c++ cmake");
    process.exit(1);
  }

  const stageDir = join(root, "dist", "rpm-staging");

  const env = {
    ...process.env,
    NODE_VERSION: nodeVersion,
    TARGET_ARCH: arch,
    RPM_VERSION: rpmVersion,
    RPM_RELEASE: rpmRelease,
    NODE_MIRROR: nodeMirror,
    WORKSPACE_DIR: root,
    STAGE_DIR: stageDir,
    OUTPUT_DIR: outDir,
  };
  if (useSystemNode) {
    env.USE_SYSTEM_NODE = "1";
  }
  if (npmRegistry) {
    env.NPM_CONFIG_REGISTRY = npmRegistry;
  }

  console.log("→ Running native RPM build...");
  run("bash", [join(root, buildScript)], { env });

  // Cleanup staging
  rmSync(stageDir, { recursive: true, force: true });
} else {
  // ═══════════════════════════════════════════════════════════════
  // Docker mode — build in a container
  // ═══════════════════════════════════════════════════════════════

  // ─── Step 1: Build Docker builder image ───
  console.log("→ Building Docker builder image...");

  const buildArgs = [
    "build",
    "-t", builderImage,
    "-f", dockerfile,
    // arm64 交叉构建：build 必须与下方 run 使用相同平台，否则本地镜像平台
    // 不匹配会让 docker run --platform linux/arm64 忽略本地镜像、转去
    // registry 拉取 meeting-rpm-builder → pull access denied。
    ...(arch === "arm64" ? ["--platform", "linux/arm64"] : []),
    "--build-arg", `BASE_IMAGE=${baseImage}`,
  ];
  if (aptMirror) {
    buildArgs.push("--build-arg", `APT_MIRROR=${aptMirror}`);
  }
  if (gemMirror) {
    buildArgs.push("--build-arg", `GEM_MIRROR=${gemMirror}`);
  }
  if (npmRegistry) {
    buildArgs.push("--build-arg", `NPM_REGISTRY=${npmRegistry}`);
  }
  buildArgs.push(".");

  run("docker", buildArgs);

  // ─── Step 2: Run build inside Docker container ───
  console.log("→ Running RPM build inside Docker...");

  const dockerArgs = [
    "run", "--rm",
    // Platform flag for arm64 cross-build
    ...(arch === "arm64" ? ["--platform", "linux/arm64"] : []),
    // Mount project root (read-write for npm install)
    "-v", `${root}:/workspace`,
    // Mount output directory
    "-v", `${outDir}:/output`,
    // Use a named volume for node_modules so the container's Linux
    // dependencies don't overwrite the host's node_modules.
    "-v", "meeting-rpm-build-modules:/workspace/node_modules",
    // Build configuration
    "-e", `NODE_VERSION=${nodeVersion}`,
    "-e", `TARGET_ARCH=${arch}`,
    "-e", `RPM_VERSION=${rpmVersion}`,
    "-e", `RPM_RELEASE=${rpmRelease}`,
    "-e", `NODE_MIRROR=${nodeMirror}`,
  ];
  if (useSystemNode) {
    dockerArgs.push("-e", "USE_SYSTEM_NODE=1");
  }
  if (npmRegistry) {
    dockerArgs.push("-e", `NPM_CONFIG_REGISTRY=${npmRegistry}`);
  }

  dockerArgs.push(builderImage, "bash", "/workspace/deploy/rpm/build-rpm.sh");

  run("docker", dockerArgs);
}

// ─── Write README ───
writeFileSync(
  join(outDir, "README.txt"),
  [
    `Offline RPM package for Meet`,
    `Arch: ${rpmArch}`,
    `Date: ${stamp}`,
    `Node: ${nodeVersion} (bundled)`,
    "",
    "Install on target (e.g. NeoKylin / Kylin / CentOS):",
    "  sudo rpm -ivh meeting-*.rpm",
    "",
    "Configure:",
    "  sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs",
    "",
    "Or manual configure:",
    "  sudo cp /opt/meeting/conf/env.example /opt/meeting/conf/.env",
    "  sudo vi /opt/meeting/conf/.env  (set MEDIASOUP_ANNOUNCED_IP)",
    "  sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs <ip>",
    "",
    "Start services:",
    "  sudo systemctl daemon-reload",
    "  sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway",
    "",
    "Verify:",
    "  curl -k https://127.0.0.1:8088/api/healthz",
    "",
    "Default login: admin / admin123",
    "",
  ].join("\n"),
);

// List output
console.log("\n✓ RPM package built in dist/rpm/");
run("ls", ["-lh", outDir]);
