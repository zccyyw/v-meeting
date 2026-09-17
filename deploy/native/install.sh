#!/usr/bin/env bash
# Meeting offline installer (Linux x64 / arm64).
# Run as root from the extracted package root:  sudo ./install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${MEETING_PREFIX:-/opt/meeting}"
APP_USER="${MEETING_USER:-meeting}"
APP_GROUP="${MEETING_GROUP:-$APP_USER}"

log() { echo "[meeting-install] $*"; }
die() { echo "[meeting-install] ERROR: $*" >&2; exit 1; }

[[ "$(uname -s)" == "Linux" ]] || die "仅支持 Linux（麒麟 / UOS / 通用发行版）"
[[ "$(id -u)" -eq 0 ]] || die "请使用 root 执行: sudo ./install.sh"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH_TAG=x64 ;;
  aarch64|arm64) ARCH_TAG=arm64 ;;
  *) die "不支持的 CPU 架构: $ARCH（需要 x86_64 或 aarch64）" ;;
esac

META_ARCH=""
if [[ -f "$ROOT/ARCH.txt" ]]; then
  META_ARCH="$(tr -d '[:space:]' < "$ROOT/ARCH.txt")"
  if [[ -n "$META_ARCH" && "$META_ARCH" != "$ARCH_TAG" ]]; then
    die "安装包架构为 $META_ARCH，当前机器为 $ARCH_TAG，请使用匹配的离线包"
  fi
fi

# Node 运行时：优先使用包内自带的（与 rpm/deb 一致 —— 目标机无需预装 Node），
# 仅当包内没有 runtime/ 时才回退到系统 PATH 中的 Node（要求 ≥ 20）。
NODE_FROM_BUNDLE=0
if [[ -x "$ROOT/runtime/bin/node" ]]; then
  NODE_FROM_BUNDLE=1
  NODE_SRC="$ROOT/runtime/bin/node"
else
  command -v node >/dev/null 2>&1 || die "包内未自带 Node 运行时（runtime/bin/node），系统 PATH 中也没有 node。请改用内嵌 Node 的 rpm/deb 包，或在目标机安装 Node.js 20+（x64 + glibc 2.17 环境需 unofficial glibc-217 版本）"
  NODE_SRC="$(command -v node)"
fi
NODE_VER="$("$NODE_SRC" -p "process.versions.node")"
NODE_MAJOR="${NODE_VER%%.*}"
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node.js 需要 ≥ 20，当前为 $NODE_VER（$NODE_SRC）"

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "创建用户 $APP_USER"
  useradd --system --home-dir "$PREFIX" --shell /usr/sbin/nologin "$APP_USER" || \
    useradd --system --home-dir "$PREFIX" --shell /sbin/nologin "$APP_USER"
fi

# 新版本号（来自包内 VERSION 文件，可覆盖）
NEW_VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION" 2>/dev/null || echo unknown)"

# 升级前备份旧版本 app（仅当已安装且版本不同）
if [[ -d "$PREFIX/app" && -f "$PREFIX/VERSION" ]]; then
  OLD_VERSION="$(tr -d '[:space:]' < "$PREFIX/VERSION" 2>/dev/null || echo unknown)"
  if [[ "$OLD_VERSION" != "$NEW_VERSION" ]]; then
    BACKUP_DIR="${MEETING_BACKUP_DIR:-/opt/meeting-backups}"
    mkdir -p "$BACKUP_DIR"
    log "检测到升级：旧版本 $OLD_VERSION -> 新版本 $NEW_VERSION，备份旧 app 到 $BACKUP_DIR/app-$OLD_VERSION"
    rm -rf "$BACKUP_DIR/app-$OLD_VERSION"
    cp -a "$PREFIX/app" "$BACKUP_DIR/app-$OLD_VERSION"
  fi
fi

log "安装到 $PREFIX"
mkdir -p "$PREFIX"/{conf,logs,bin,app}
rm -rf "$PREFIX/app"
mkdir -p "$PREFIX/app"

# App payload
cp -a "$ROOT/app/." "$PREFIX/app/"
cp -a "$ROOT/bin/." "$PREFIX/bin/" 2>/dev/null || true
chmod +x "$PREFIX/bin/"*.sh 2>/dev/null || true
chmod +x "$PREFIX/bin/gateway.mjs" 2>/dev/null || true
chmod +x "$PREFIX/bin/genssl.sh" 2>/dev/null || true

# Node 运行时：包内自带时安装到 $PREFIX/runtime（与 rpm/deb 的 /opt/meeting/runtime 对齐），
# 否则沿用系统 Node。升级时整体替换，避免残留旧版本的运行时。
rm -rf "$PREFIX/runtime"
if [[ "$NODE_FROM_BUNDLE" == "1" ]]; then
  mkdir -p "$PREFIX/runtime"
  cp -a "$ROOT/runtime/." "$PREFIX/runtime/"
  NODE_BIN="$PREFIX/runtime/bin/node"
  log "使用包内自带 Node 运行时：$NODE_BIN（$NODE_VER）"
else
  NODE_BIN="$NODE_SRC"
  log "使用系统 Node：$NODE_BIN（$NODE_VER）"
fi

# Config
if [[ ! -f "$PREFIX/conf/.env" ]]; then
  cp "$ROOT/conf/env.example" "$PREFIX/conf/.env"
  log "已生成 $PREFIX/conf/.env ，请按现场修改后执行 migrate/seed 或重新运行本脚本续装"
else
  log "保留已有配置 $PREFIX/conf/.env"
fi
cp "$ROOT/conf/env.example" "$PREFIX/conf/env.example"
cp "$ROOT/conf/nginx-meeting.conf" "$PREFIX/conf/nginx-meeting.conf"

# Symlink node helper：$PREFIX/bin/node → 实际使用的运行时（包内自带时为 $PREFIX/runtime/bin/node）
ln -sfn "$NODE_BIN" "$PREFIX/bin/node"

# 网关默认监听 443（特权端口）：为 node 授予绑定低位端口能力。
# systemd 单元已配 AmbientCapabilities（systemd ≥ 229）；此处 setcap 兜底旧版 systemd（219，麒麟 V10 SP1）。
# 说明：包内自带运行时（runtime/）时，setcap 只作用于包内 node，不影响本机其它 node 进程；
# 仅当回退到系统 Node 时才会作用于系统 node（此时本机所有 node 进程都可绑定低位端口）。
# 如安全要求更高，可改用 Nginx 前置（见 conf/nginx-meeting-ssl.conf），
# 届时删除本段 setcap 并依赖单元 AmbientCapabilities 即可。
if command -v setcap >/dev/null 2>&1; then
  setcap 'cap_net_bind_service=+ep' "$NODE_BIN" 2>/dev/null \
    && log "已授予 cap_net_bind_service（可绑定 443）：$NODE_BIN" \
    || log "提示：setcap 未生效；若 443 绑定失败请手动授权或改用 Nginx 前置"
fi

chown -R "$APP_USER:$APP_GROUP" "$PREFIX"

# 记录当前版本，供下次升级比对
echo "$NEW_VERSION" > "$PREFIX/VERSION"

# systemd units
if [[ -d /etc/systemd/system ]]; then
  log "安装 systemd 单元"
  for unit in meeting-api.service meeting-realtime.service meeting-gateway.service; do
    sed -e "s|@PREFIX@|$PREFIX|g" \
        -e "s|@USER@|$APP_USER|g" \
        -e "s|@GROUP@|$APP_GROUP|g" \
        -e "s|@NODE@|$NODE_BIN|g" \
        "$ROOT/systemd/$unit" > "/etc/systemd/system/$unit"
  done
  systemctl daemon-reload
else
  log "未检测到 systemd，请使用 $PREFIX/bin/start-all.sh 手动启动"
fi

# Optional nginx site
if command -v nginx >/dev/null 2>&1; then
  if [[ -d /etc/nginx/conf.d ]]; then
    cp "$PREFIX/conf/nginx-meeting.conf" /etc/nginx/conf.d/meeting.conf
    log "已写入 /etc/nginx/conf.d/meeting.conf （gateway 与 nginx 二选一，见文档）"
  fi
fi

ENV_FILE="$PREFIX/conf/.env"
run_node() {
  local dir="$1"; shift
  ( cd "$dir" && "$NODE_BIN" --env-file="$ENV_FILE" "$@" )
}

log "执行数据库迁移"
# 发布包默认数据库为 MySQL：若目标机数据库尚未就绪（未建库/未启动/口令不符），
# 不应中断整段安装，而是给出可操作提示——配好 conf/.env 后重新运行本脚本即可续装。
run_node "$PREFIX/app/serve/api" dist/migrate.js \
  || log "迁移失败：请确认 conf/.env 的数据库配置可用（默认 MySQL 需先建库建用户并启动数据库），修正后重新运行 sudo ./install.sh"

if [[ "${MEETING_SKIP_SEED:-0}" != "1" ]]; then
  log "写入默认用户：admin/admin123（超级管理员）、test1-5/123456（普通用户）（可用 MEETING_SKIP_SEED=1 跳过）"
  run_node "$PREFIX/app/serve/api" dist/seed-admin.js || log "seed 已存在或失败（可稍后手动执行）"
fi

if [[ ! -f "$PREFIX/certs/fullchain.pem" ]]; then
  log "警告：未检测到证书，网关将以明文 HTTP 监听 443。请先生成证书再重启："
  log "  sudo $PREFIX/bin/genssl.sh <服务器IP> && sudo systemctl restart meeting-gateway"
fi

if command -v systemctl >/dev/null 2>&1 && [[ -f /etc/systemd/system/meeting-api.service ]]; then
  log "启动服务"
  systemctl enable meeting-api meeting-realtime meeting-gateway
  systemctl restart meeting-api meeting-realtime meeting-gateway
  sleep 1
  systemctl --no-pager --full status meeting-api meeting-realtime meeting-gateway || true
fi

log "完成"
log "  配置: $PREFIX/conf/.env"
log "  Node 运行时: $NODE_BIN（$NODE_VER）"
log "  网关默认: https://0.0.0.0:\${GATEWAY_PORT:-443}  （/ → 前端, /api → API, /ws → 信令）"
log "  健康检查: curl -k https://127.0.0.1/api/healthz"
log "  默认账号: admin / admin123 （生产请立即修改密码）"
log "说明文档: $ROOT/INSTALL.md"
