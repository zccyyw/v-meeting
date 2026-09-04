#!/usr/bin/env node
/**
 * Build an offline native release under dist/native/.
 * MUST run on the same OS/CPU as the target (Linux x64 or arm64) so mediasoup natives match.
 */
import {
  cpSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const platform = process.platform;
const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : process.arch;
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const outRoot = join(root, "dist", "native");
const stage = join(outRoot, "staging");
const bundleName = `meeting-linux-${arch}-${stamp}`;
const bundleDir = join(outRoot, bundleName);

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function copy(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

if (platform !== "linux") {
  console.warn(
    `[pack-native] WARNING: current OS is ${platform}. mediasoup native addons in the tarball will match THIS machine, not Linux/${arch} targets.`,
  );
  console.warn(
    "[pack-native] Build the release on a Linux x64/arm64 host (or Kylin aarch64 CI) for production.",
  );
  if (process.env.PACK_NATIVE_FORCE !== "1") {
    console.error("Refusing to pack. Set PACK_NATIVE_FORCE=1 to override (dev only).");
    process.exit(1);
  }
}

console.log(`→ pack-native for linux-${arch}`);

rmSync(stage, { recursive: true, force: true });
rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

console.log("→ build packages");
run("npm", ["run", "build:shared"]);
run("npm", ["run", "build", "-w", "@meeting/api"]);
run("npm", ["run", "build", "-w", "@meeting/realtime"]);
run("npm", ["run", "build", "-w", "@meeting/front"], {
  env: {
    VITE_API_BASE: process.env.VITE_API_BASE || "/api",
    VITE_WS_URL: process.env.VITE_WS_URL || "auto",
  },
});

const stagingPkg = {
  name: "meeting-native-bundle",
  private: true,
  workspaces: ["serve/shared", "serve/db", "serve/api", "serve/realtime"],
};
writeFileSync(join(stage, "package.json"), JSON.stringify(stagingPkg, null, 2));

for (const name of ["shared", "db", "api", "realtime"]) {
  const src = join(root, "serve", name);
  const dest = join(stage, "serve", name);
  mkdirSync(dest, { recursive: true });
  copy(join(src, "package.json"), join(dest, "package.json"));
  copy(join(src, "dist"), join(dest, "dist"));
  if (name === "api") {
    copy(join(src, "src", "sql"), join(dest, "dist", "sql"));
  }
}

// Strip devDependencies from workspace package.json copies for cleaner install
for (const name of ["shared", "db", "api", "realtime"]) {
  const p = join(stage, "serve", name, "package.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  delete j.devDependencies;
  delete j.scripts?.test;
  writeFileSync(p, JSON.stringify(j, null, 2));
}

console.log("→ npm install --omit=dev (build host needs network once)");
run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: stage });

mkdirSync(bundleDir, { recursive: true });
copy(join(stage, "package.json"), join(bundleDir, "app", "package.json"));
copy(join(stage, "node_modules"), join(bundleDir, "app", "node_modules"));
copy(join(stage, "serve"), join(bundleDir, "app", "serve"));
copy(join(root, "front", "dist"), join(bundleDir, "app", "front"));

copy(join(root, "deploy", "native", "bin"), join(bundleDir, "bin"));
copy(join(root, "deploy", "native", "conf"), join(bundleDir, "conf"));
copy(join(root, "deploy", "native", "systemd"), join(bundleDir, "systemd"));
copy(join(root, "deploy", "native", "install.sh"), join(bundleDir, "install.sh"));
copy(join(root, "deploy", "native", "INSTALL.md"), join(bundleDir, "INSTALL.md"));

writeFileSync(join(bundleDir, "ARCH.txt"), arch + "\n");
writeFileSync(
  join(bundleDir, "BUILD.txt"),
  [
    `platform=${platform}`,
    `arch=${arch}`,
    `node=${process.version}`,
    `date=${new Date().toISOString()}`,
    `vite_api_base=${process.env.VITE_API_BASE || "/api"}`,
    `vite_ws_url=${process.env.VITE_WS_URL || "auto"}`,
  ].join("\n") + "\n",
);

try {
  chmodSync(join(bundleDir, "install.sh"), 0o755);
  chmodSync(join(bundleDir, "bin", "start-all.sh"), 0o755);
  chmodSync(join(bundleDir, "bin", "stop-all.sh"), 0o755);
  chmodSync(join(bundleDir, "bin", "gateway.mjs"), 0o755);
  chmodSync(join(bundleDir, "bin", "genssl.sh"), 0o755);
} catch {
  /* windows pack host */
}

const tarPath = join(outRoot, `${bundleName}.tar.gz`);
rmSync(tarPath, { force: true });
console.log(`→ tar ${tarPath}`);
run("tar", ["-czf", tarPath, "-C", outRoot, bundleName]);

rmSync(stage, { recursive: true, force: true });

writeFileSync(
  join(outRoot, "README.txt"),
  [
    `Offline native bundle: ${bundleName}.tar.gz`,
    `Arch: ${arch}  (install on matching Linux CPU)`,
    "",
    "On target:",
    `  tar -xzf ${bundleName}.tar.gz`,
    `  cd ${bundleName}`,
    "  sudo ./install.sh",
    "",
    "See INSTALL.md inside the tarball.",
    "",
  ].join("\n"),
);

console.log(`✓ packed ${tarPath}`);
