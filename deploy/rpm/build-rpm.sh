#!/usr/bin/env bash
# =============================================================================
# RPM build script — runs INSIDE Docker container OR directly on a Linux host.
#
# Environment variables:
#   NODE_VERSION     – e.g. v22.23.1 (default: v22.23.1)
#   TARGET_ARCH      – x64 | arm64    (default: x64)
#   RPM_VERSION      – e.g. 0.1       (default: 0.1)
#   RPM_RELEASE      – e.g. 1         (default: 1)
#   NODE_MIRROR      – Node.js download mirror base URL
#                      (default: https://nodejs.org/dist)
#   WORKSPACE_DIR    – project root   (default: /workspace)
#   STAGE_DIR        – staging area   (default: /staging)
#   OUTPUT_DIR       – output dir     (default: /output)
#   USE_SYSTEM_NODE  – if "1", copy system node binary instead of downloading
# =============================================================================
set -e
set -x

# ─── Read configuration from env ───
NODE_VERSION="${NODE_VERSION:-v22.23.1}"
TARGET_ARCH="${TARGET_ARCH:-x64}"
RPM_VERSION="${RPM_VERSION:-0.1}"
RPM_RELEASE="${RPM_RELEASE:-1}"
NODE_MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
STAGE_DIR="${STAGE_DIR:-/staging}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
USE_SYSTEM_NODE="${USE_SYSTEM_NODE:-}"

# Map arch names
if [ "$TARGET_ARCH" = "arm64" ]; then
  NODE_ARCH="arm64"
  RPM_ARCH="aarch64"
else
  NODE_ARCH="x64"
  RPM_ARCH="x86_64"
fi

cd "$WORKSPACE_DIR"

# ─── Configure node-gyp to use mirror (for native module compilation) ───
# When NODE_MIRROR points to a China mirror, node-gyp also needs to download
# Node.js headers from there instead of nodejs.org.
# We use THREE approaches simultaneously for maximum compatibility:
#   1. NODEJS_ORG_MIRROR env var (read by node-gyp directly)
#   2. npm_config_nodejs_org_mirror env var (read by node-gyp via npm config)
#   3. Manually download headers and set --nodedir (bulletproof fallback)
if [ "$NODE_MIRROR" != "https://nodejs.org/dist" ]; then
  export NODEJS_ORG_MIRROR="$NODE_MIRROR"
  export npm_config_nodejs_org_mirror="$NODE_MIRROR"
  echo "→ node-gyp mirror: $NODE_MIRROR"

  # Download Node.js headers manually and point node-gyp to them
  # This is the most reliable approach — bypasses node-gyp's own download logic
  SYS_NODE_VER="$(node --version)"
  HEADERS_TAR="node-${SYS_NODE_VER}-headers.tar.gz"
  echo "→ Downloading Node.js headers from ${NODE_MIRROR}/${SYS_NODE_VER}/${HEADERS_TAR}"
  if curl -fsSL "${NODE_MIRROR}/${SYS_NODE_VER}/${HEADERS_TAR}" -o "/tmp/${HEADERS_TAR}"; then
    rm -rf /tmp/node-headers
    mkdir -p /tmp/node-headers
    # --strip-components=1 removes the top-level "node-vX.Y.Z/" directory
    # so that common.gypi lands directly in /tmp/node-headers/
    tar -xzf "/tmp/${HEADERS_TAR}" -C /tmp/node-headers --strip-components=1
    # node-gyp expects config.gypi at include/node/config.gypi
    # Some headers tarballs only have it at root — copy if missing
    if [ ! -f /tmp/node-headers/include/node/config.gypi ] && [ -f /tmp/node-headers/config.gypi ]; then
      cp /tmp/node-headers/config.gypi /tmp/node-headers/include/node/config.gypi
    fi
    export npm_config_nodedir=/tmp/node-headers
    echo "→ node-gyp nodedir: /tmp/node-headers"
  else
    echo "WARNING: Failed to download headers from mirror, will try node-gyp default" >&2
  fi
fi

# ─── Obtain Node.js binary (to embed in RPM) ───
if [ "$USE_SYSTEM_NODE" = "1" ]; then
  # Use the system Node.js binary — avoids downloading when network is restricted
  SYSTEM_NODE_BIN="$(command -v node)"
  if [ -z "$SYSTEM_NODE_BIN" ]; then
    echo "ERROR: USE_SYSTEM_NODE=1 but 'node' not found in PATH" >&2
    exit 1
  fi
  echo "→ Using system Node.js: $SYSTEM_NODE_BIN ($(node --version))"
  NODE_BIN="$SYSTEM_NODE_BIN"
else
  NODE_TAR="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
  echo "→ Downloading Node.js from ${NODE_MIRROR}/${NODE_VERSION}/${NODE_TAR}"
  curl -fsSL "${NODE_MIRROR}/${NODE_VERSION}/${NODE_TAR}" -o "/tmp/${NODE_TAR}"
  tar -xf "/tmp/${NODE_TAR}" -C /tmp
  NODE_BIN="/tmp/node-${NODE_VERSION}-linux-${NODE_ARCH}/bin/node"
fi

# ─── Build project ───
# mediasoup worker 获取策略：默认优先下载官方预编译二进制（x64/arm64 均有
# kernel6 发布产物，秒级完成）；下载/校验失败自动回退本地编译。
# 本地编译依赖 pip 安装 meson/ninja/invoke，而 CI runner 位于境外、
# 清华 PyPI 镜像不可达（会报 "No matching distribution found for invoke"），
# 因此默认不再强制本地编译。国内网络需要强制本地编译时：
#   BUILD_WORKER_LOCALLY=1 ... npm run pack:rpm
#   PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple ...（默认镜像）
if [ "${BUILD_WORKER_LOCALLY:-}" = "1" ]; then
  export MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD=true
  echo "→ mediasoup worker: local build requested"
else
  unset MEDIASOUP_SKIP_WORKER_PREBUILT_DOWNLOAD
  echo "→ mediasoup worker: prefer prebuilt download (fallback: local build)"
fi
export PIP_INDEX_URL="${PIP_INDEX_URL:-https://pypi.org/simple}"
GHPROXY="${GHPROXY:-https://gh-proxy.com}"

npm install --no-audit --no-fund --ignore-scripts

# Patch mediasoup wrap files and build worker
if [ -d "$WORKSPACE_DIR/node_modules/mediasoup/worker/subprojects" ]; then
  echo "→ Patching mediasoup wrap files (ghproxy=$GHPROXY)..."
  cd "$WORKSPACE_DIR"
  node ./serve/realtime/patch-mediasoup-wrap.cjs "$GHPROXY"
  echo "→ Building mediasoup worker..."
  cd "$WORKSPACE_DIR/node_modules/mediasoup"
  # 使用 venv Python：Debian 12 (PEP 668) 下系统 python3 禁止裸 pip install，
  # mediasoup postinstall 内的 `pip install --target ...` 会因此失败。
  # mediasoup 尊重 $PYTHON 环境变量；venv 自带 pip 且不受 externally-managed 限制。
  if [ -x /opt/mediasoup-venv/bin/python ]; then
    export PYTHON=/opt/mediasoup-venv/bin/python
    echo "→ Using venv Python for mediasoup worker build: $PYTHON"
  fi
  node npm-scripts.mjs postinstall
fi

# Rebuild better-sqlite3 (its install script was skipped by --ignore-scripts)
echo "→ Rebuilding better-sqlite3..."
cd "$WORKSPACE_DIR"
npm rebuild better-sqlite3

npm run build:shared
npm run build -w @meeting/api
npm run build -w @meeting/realtime
npm run build -w @meeting/front

# ─── Assemble staging directory ───
STAGE="$STAGE_DIR"
rm -rf "$STAGE"
mkdir -p "$STAGE/opt/meeting/app" "$STAGE/opt/meeting/bin" "$STAGE/opt/meeting/conf" \
         "$STAGE/opt/meeting/data" "$STAGE/opt/meeting/logs" "$STAGE/opt/meeting/certs" \
         "$STAGE/opt/meeting/runtime/bin"
mkdir -p "$STAGE/opt/meeting/app/serve"
mkdir -p "$STAGE/usr/lib/systemd/system"

# Embed Node.js runtime
cp "$NODE_BIN" "$STAGE/opt/meeting/runtime/bin/node"

# Copy compiled serve packages
for name in shared db api realtime; do
  src="$WORKSPACE_DIR/serve/$name"
  dst="$STAGE/opt/meeting/app/serve/$name"
  mkdir -p "$dst"
  cp "$src/package.json" "$dst/"
  cp -r "$src/dist" "$dst/"
  if [ -d "$src/src/sql" ]; then
    cp -r "$src/src/sql" "$dst/dist/"
  fi
done

# ─── Production dependencies: reuse workspace node_modules ───
# 不在 staging 重新 npm install：
#   1. 避免 mediasoup postinstall 二次获取/编译 worker（qemu arm64 下曾耗时数小时）
#   2. 避免 qemu 下全量解压数万个文件（30 分钟以上）
# 做法：构建完成后 npm prune --omit=dev 裁掉 devDependencies，
#       再把 workspace 的 node_modules（根 + 各子包）复制进 staging。
#       npm workspaces 的包链接（@meeting/* → serve/*）为相对 symlink，
#       cp -a 复制后在 staging 目录结构中依然有效。
echo "→ Pruning devDependencies from workspace node_modules..."
cd "$WORKSPACE_DIR"
npm prune --omit=dev --no-audit --no-fund

echo "→ Copying production node_modules to staging..."
mkdir -p "$STAGE/opt/meeting/app"
cp -a "$WORKSPACE_DIR/node_modules" "$STAGE/opt/meeting/app/node_modules"
for name in shared db api realtime; do
  if [ -d "$WORKSPACE_DIR/serve/$name/node_modules" ]; then
    cp -a "$WORKSPACE_DIR/serve/$name/node_modules" "$STAGE/opt/meeting/app/serve/$name/node_modules"
  fi
done

# Copy front static files
cp -r "$WORKSPACE_DIR/front/dist" "$STAGE/opt/meeting/app/front"

# Copy bin scripts (.mjs only, no .sh)
cp "$WORKSPACE_DIR/deploy/native/bin/gateway.mjs"    "$STAGE/opt/meeting/bin/"
cp "$WORKSPACE_DIR/deploy/native/bin/configure.mjs"  "$STAGE/opt/meeting/bin/"
cp "$WORKSPACE_DIR/deploy/native/bin/gen-cert.mjs"   "$STAGE/opt/meeting/bin/"
cp "$WORKSPACE_DIR/deploy/native/bin/start-all.mjs"  "$STAGE/opt/meeting/bin/"
cp "$WORKSPACE_DIR/deploy/native/bin/stop-all.mjs"   "$STAGE/opt/meeting/bin/"

# Install node-forge for gen-cert.mjs (pure-JS cert generation)
cd "$STAGE/opt/meeting/bin"
npm init -y > /dev/null 2>&1
npm install node-forge --no-audit --no-fund --omit=dev 2>/dev/null

# Copy config template
cp "$WORKSPACE_DIR/deploy/native/conf/env.example" "$STAGE/opt/meeting/conf/"

# Copy systemd units (RPM version with embedded paths)
cp "$WORKSPACE_DIR/deploy/native/systemd-rpm/meeting-api.service"      "$STAGE/usr/lib/systemd/system/"
cp "$WORKSPACE_DIR/deploy/native/systemd-rpm/meeting-realtime.service" "$STAGE/usr/lib/systemd/system/"
cp "$WORKSPACE_DIR/deploy/native/systemd-rpm/meeting-gateway.service"  "$STAGE/usr/lib/systemd/system/"

# Create placeholder directories
mkdir -p "$STAGE/opt/meeting/data"
touch "$STAGE/opt/meeting/data/.gitkeep"
mkdir -p "$STAGE/opt/meeting/logs"
touch "$STAGE/opt/meeting/logs/.gitkeep"

# ─── Build RPM ───
cd "$STAGE"

if command -v fpm &>/dev/null; then
  # ── Use fpm (preferred) ──
  echo "→ Building RPM with fpm..."
  fpm -s dir -t rpm \
    -n meeting \
    -v "${RPM_VERSION}" \
    --iteration "${RPM_RELEASE}" \
    -a "${RPM_ARCH}" \
    --rpm-os linux \
    --description "Meet video conferencing system" \
    --license "Proprietary" \
    --vendor "Meet" \
    --url "https://example.com" \
    --after-install "$WORKSPACE_DIR/deploy/rpm/post.sh" \
    --before-remove "$WORKSPACE_DIR/deploy/rpm/preun.sh" \
    --no-auto-depends \
    --directories /opt/meeting \
    --config-files /opt/meeting/conf/env.example \
    .

  # ─── Copy RPM to output ───
  mkdir -p "$OUTPUT_DIR"
  cp meeting-*.rpm "$OUTPUT_DIR/"
else
  # ── Use rpmbuild (fallback — no Ruby/fpm needed) ──
  echo "→ fpm not found, building RPM with rpmbuild..."

  if ! command -v rpmbuild &>/dev/null; then
    echo "ERROR: Neither fpm nor rpmbuild found." >&2
    echo "  Install rpm-build:  yum install -y rpm-build" >&2
    exit 1
  fi

  RPMTOP="$STAGE/rpmbuild"
  mkdir -p "$RPMTOP"/{BUILD,RPMS,SOURCES,SPECS}

  # Generate spec file (quoted heredoc to prevent shell expansion of %, $, etc.)
  cat > "$RPMTOP/SPECS/meeting.spec" <<'SPECEOF'
Name:           meeting
Version:        @@RPM_VERSION@@
Release:        @@RPM_RELEASE@@%{?dist}
Summary:        Meet video conferencing system
License:        Proprietary
Vendor:         Meet
URL:            https://example.com
AutoReqProv:    no
BuildArch:      @@RPM_ARCH@@

%global _use_internal_dependency_generator 0
%global __requires_exclude ^.*$
%global __provides_exclude ^.*$

%description
Meet video conferencing system with WebRTC SFU,
REST API, and real-time signaling.
Supports SQLite (zero-dependency), MySQL, and PostgreSQL.

%prep
# nothing (pre-built payload)

%build
# nothing

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}
cp -a @@PAYLOAD_DIR@@/opt %{buildroot}/
cp -a @@PAYLOAD_DIR@@/usr %{buildroot}/

%files
/opt/meeting
/usr/lib/systemd/system/meeting-api.service
/usr/lib/systemd/system/meeting-realtime.service
/usr/lib/systemd/system/meeting-gateway.service
%config(noreplace) /opt/meeting/conf/env.example

%pre
if ! id meeting >/dev/null 2>&1; then
    useradd --system --home-dir /opt/meeting --shell /sbin/nologin meeting 2>/dev/null || true
fi

%post
systemctl daemon-reload 2>/dev/null || true

# Create runtime directories with correct ownership
mkdir -p /opt/meeting/logs /opt/meeting/data /opt/meeting/certs
chown -R meeting:meeting /opt/meeting 2>/dev/null || true

echo ""
echo "Meet has been installed to /opt/meeting"
echo ""
echo "Next steps:"
echo "  1. Configure:  sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs"
echo "     Or manual:  cp /opt/meeting/conf/env.example /opt/meeting/conf/.env"
echo "                 vi /opt/meeting/conf/.env"
echo "                 (set MEDIASOUP_ANNOUNCED_IP=<server-ip>)"
echo ""
echo "  2. Cert (opt): sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/gen-cert.mjs <server-ip>"
echo ""
echo "  3. Start:      sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway"
echo ""
echo "  4. Verify:     curl -k https://127.0.0.1:8088/api/healthz"
echo ""
echo "  Default login: admin / admin123"
echo ""

%preun
if [ $1 -eq 0 ]; then
    systemctl --no-block stop meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
    systemctl disable meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
fi

%postun
if [ $1 -eq 0 ]; then
    systemctl daemon-reload 2>/dev/null || true
fi

%changelog
* Fri Jul 31 2026 Meet <meet@example.com> - 0.1-1
- Initial RPM release
SPECEOF

  # Inject variables into spec file
  sed -i \
    -e "s|@@RPM_VERSION@@|${RPM_VERSION}|g" \
    -e "s|@@RPM_RELEASE@@|${RPM_RELEASE}|g" \
    -e "s|@@RPM_ARCH@@|${RPM_ARCH}|g" \
    -e "s|@@PAYLOAD_DIR@@|${STAGE}|g" \
    "$RPMTOP/SPECS/meeting.spec"

  # Build binary RPM
  rpmbuild -bb --define "_topdir $RPMTOP" "$RPMTOP/SPECS/meeting.spec"

  # Find and copy RPM to output
  mkdir -p "$OUTPUT_DIR"
  find "$RPMTOP/RPMS" -name "meeting-*.rpm" -exec cp {} "$OUTPUT_DIR/" \;
fi

echo ""
echo "=== RPM built successfully ==="
ls -lh "$OUTPUT_DIR"/*.rpm
