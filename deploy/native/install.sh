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

command -v node >/dev/null 2>&1 || die "未找到 node，请先安装 Node.js 20+（arm64/x64）"
NODE_BIN="$(command -v node)"
NODE_VER="$("$NODE_BIN" -p "process.versions.node")"
NODE_MAJOR="${NODE_VER%%.*}"
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node.js 需要 ≥ 20，当前为 $NODE_VER"

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "创建用户 $APP_USER"
  useradd --system --home-dir "$PREFIX" --shell /usr/sbin/nologin "$APP_USER" || \
    useradd --system --home-dir "$PREFIX" --shell /sbin/nologin "$APP_USER"
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

# Config
if [[ ! -f "$PREFIX/conf/.env" ]]; then
  cp "$ROOT/conf/env.example" "$PREFIX/conf/.env"
  log "已生成 $PREFIX/conf/.env ，请按现场修改后执行 migrate/seed 或重新运行本脚本续装"
else
  log "保留已有配置 $PREFIX/conf/.env"
fi
cp "$ROOT/conf/env.example" "$PREFIX/conf/env.example"
cp "$ROOT/conf/nginx-meeting.conf" "$PREFIX/conf/nginx-meeting.conf"

# Symlink node helper
ln -sfn "$NODE_BIN" "$PREFIX/bin/node"

chown -R "$APP_USER:$APP_GROUP" "$PREFIX"

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
run_node "$PREFIX/app/serve/api" dist/migrate.js

if [[ "${MEETING_SKIP_SEED:-0}" != "1" ]]; then
  log "写入默认用户：admin/admin123（超级管理员）、test1-5/123456（普通用户）（可用 MEETING_SKIP_SEED=1 跳过）"
  run_node "$PREFIX/app/serve/api" dist/seed-admin.js || log "seed 已存在或失败（可稍后手动执行）"
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
log "  网关默认: http://0.0.0.0:\${GATEWAY_PORT:-8088}  （/ → 前端, /api → API, /ws → 信令）"
log "  健康检查: curl http://127.0.0.1:8088/api/healthz"
log "  默认账号: admin / admin123 （生产请立即修改密码）"
log "说明文档: $ROOT/INSTALL.md"
