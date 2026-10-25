#!/usr/bin/env bash
# Meeting Docker 离线包一键部署脚本（统一入口）
#
#   1. 按需加载离线镜像（meeting-api/meeting-realtime/meeting-web 及基础镜像，
#      已存在则跳过 docker load，幂等）
#   2. 准备 .env：不存在时从 env.example 生成；机密参数自动生成（幂等，不覆盖已有真实值）：
#        - MEETING_CRYPTO_KEY / MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD / REDIS_PASSWORD
#        - POSTGRES_PASSWORD（仅 postgres profile）
#   3. MEDIASOUP_ANNOUNCED_IP 自动探测本机对外 IP 写入默认值（跨 NAT 需人工确认）
#   4. 启动/停止统一通过 docker-compose 命令：
#        up    启动（默认）        stop   停止（保留容器与数据）
#        down  卸载（保留数据卷）  down -v 卸载并删除数据卷
#
# 用法：
#   bash install.sh              # 部署：加载镜像(按需) + 准备 .env + docker-compose up -d
#   bash install.sh stop         # 停止
#   bash install.sh down         # 卸载（保留数据）
#   bash install.sh down -v      # 卸载并清空数据卷
#   bash install.sh --env-only   # 仅准备 .env，不加载镜像不启动
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
CMD="${1:-up}"

compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose -p meeting "$@"
  elif docker compose version >/dev/null 2>&1; then
    docker compose -p meeting "$@"
  else
    echo "!! 未找到 docker-compose 命令或 docker compose 插件，请先安装 Docker Compose v2+" >&2
    exit 1
  fi
}

case "$CMD" in
  stop)
    if compose stop; then
      echo "OK: 已停止（数据保留；bash install.sh 可再次启动）"
    else
      echo "!! 停止失败，请检查上方报错" >&2
      exit 1
    fi
    exit 0
    ;;
  down)
    shift # 去掉 "down"，其余参数（如 -v）透传给 compose。
          # 原实现仅在有多参数时 shift——纯 `install.sh down` 会把 "down"
          # 再传一次变成 `compose down down`（把 down 当服务名），
          # 实际未卸载却提示成功
    if compose down "$@"; then
      echo "OK: 已卸载（未加 -v 时数据卷保留）"
    else
      echo "!! 卸载失败，请检查上方报错" >&2
      exit 1
    fi
    exit 0
    ;;
  up|--env-only)
    ;;
  *)
    echo "未知参数: $CMD（可用: up / stop / down / --env-only）" >&2
    exit 1
    ;;
esac

# ── 1. 按需加载离线镜像 ──
if [ "$CMD" = "up" ]; then
  need_app=0
  need_base=0
  # app 三镜像逐一检测（api/realtime/web 同属 app tar——只查 api 会在
  # realtime/web 被误删时跳过 load，导致 compose 起不来）
  for img in meeting-api:latest meeting-realtime:latest meeting-web:latest; do
    docker image inspect "$img" >/dev/null 2>&1 || need_app=1
  done
  # base 镜像检测与 pack-docker.mjs 同源：从 compose 的 image: 行动态解析
  # （排除 ${VAR} 形式的自建镜像引用）。曾因只探测 mysql:8.4，升级时旧机
  # 已加载 mysql 便跳过 load，导致新 tag 的 redis/caddy 未加载、compose
  # 转而联网拉取（内网必超时）。
  for img in $(grep -E '^[[:space:]]*image:[[:space:]]*[^[:space:]]+' docker-compose.yml | awk '{print $2}' | grep -v '\${'); do
    docker image inspect "$img" >/dev/null 2>&1 || need_base=1
  done
  if [ "$need_app" = 0 ] && [ "$need_base" = 0 ]; then
    echo "-> 镜像已加载，跳过 docker load"
  else
    for tar in meeting-app-*.tar meeting-base-*.tar; do
      [ -f "$tar" ] || continue
      echo "-> docker load -i $tar"
      docker load -i "$tar"
    done
  fi
fi

# ── 2. .env 不存在则从模板创建 ──
ENV_FILE=".env"
EXAMPLE="env.example"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$EXAMPLE" ]; then
    cp "$EXAMPLE" "$ENV_FILE"
    echo "-> 已从 $EXAMPLE 生成 $ENV_FILE"
  else
    : > "$ENV_FILE"
    echo "-> 未找到 $EXAMPLE，已创建空 $ENV_FILE"
  fi
else
  echo "-> $ENV_FILE 已存在，保留现有配置"
fi

# ── 3. 机密参数自动生成 ──
gen_secret() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -d '\n'
  else
    head -c "$bytes" /dev/urandom | base64 | tr -d '\n'
  fi
}

# 幂等写入：删除所有（含注释的）旧行后追加一条真实值。
# 注意不用 && 链：grep -v 在"删除后无剩余行"时返回 1，会让 set -e 误判
# 整个函数失败（新值丢失/脚本退出）
set_env_value() {
  local key="$1" val="$2"
  if grep -qE "^\s*#?\s*${key}=" "$ENV_FILE"; then
    grep -vE "^\s*#?\s*${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" || true
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

get_env_value() {
  grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true
}

ensure_secret() {
  local key="$1"; shift
  local placeholders=("$@")
  local cur
  cur="$(get_env_value "$key")"
  local p
  for p in "${placeholders[@]}"; do
    if [ "$cur" = "$p" ]; then cur=""; break; fi
  done
  if [ -n "$cur" ]; then
    echo "-> $key 已配置，跳过生成"
  else
    set_env_value "$key" "$(gen_secret 32)"
    echo "-> 已自动生成 $key"
  fi
}

ensure_secret MEETING_CRYPTO_KEY "change-me-crypto-key"
ensure_secret MYSQL_PASSWORD "change-me" "meetingpass" "meetingpass123"
ensure_secret MYSQL_ROOT_PASSWORD "change-me-root" "rootpass" "root"
ensure_secret REDIS_PASSWORD "change-me-redis" "meetingpass" "redispass"

# POSTGRES_PASSWORD 仅在启用 postgres profile 时生成（默认值 postgres 为弱口令）
if [ "$(get_env_value COMPOSE_PROFILES)" = "postgres" ]; then
  ensure_secret POSTGRES_PASSWORD "postgres"
fi

# ── 4. MEDIASOUP_ANNOUNCED_IP 自动探测（占位值时）──
detect_announced_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)"
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  [ -n "$ip" ] && printf '%s' "$ip"
  return 0
}

announced="$(get_env_value MEDIASOUP_ANNOUNCED_IP)"
if [ -z "$announced" ] || [ "$announced" = "10.0.0.10" ] || [ "$announced" = "127.0.0.1" ]; then
  detected="$(detect_announced_ip || true)"
  if [ -n "$detected" ]; then
    set_env_value MEDIASOUP_ANNOUNCED_IP "$detected"
    announced="$detected"
    echo "-> 已自动探测 MEDIASOUP_ANNOUNCED_IP=$detected"
  fi
fi
echo "==============================================================="
echo "!! 请人工确认 MEDIASOUP_ANNOUNCED_IP=$announced"
echo "   · 局域网/同 VPC 内访问：本机内网 IP（自动探测值通常正确）"
echo "   · 跨 NAT/公网访问：必须改为公网 IP，否则「能进会但无音视频」"
echo "==============================================================="

# ── 4.5 证书自检：缺失时自动生成 ──
# Caddyfile 硬编码从挂载的 certs 目录加载 fullchain.pem/privkey.pem，
# 缺失会导致 caddy 反复报 "no such file or directory" 起不来、443 无入口
# （首次部署极易漏掉手动生成证书这一步）。
CERT_DIR_LOCAL="deploy/docker/certs"
CERT_GENERATED=0
if [ ! -f "$CERT_DIR_LOCAL/fullchain.pem" ] || [ ! -f "$CERT_DIR_LOCAL/privkey.pem" ]; then
  GEN="deploy/docker/gen-selfsigned.sh"
  if [ -f "$GEN" ]; then
    cert_host="$announced"
    if [ -z "$cert_host" ] || [ "$cert_host" = "10.0.0.10" ]; then
      cert_host="$(detect_announced_ip || true)"
    fi
    echo "-> 未检测到证书，自动生成自签/CA 证书（ca.crt 需导入参会电脑；正式环境请替换为单位颁发的证书）"
    if bash "$GEN" --ca "${cert_host:-127.0.0.1}"; then
      CERT_GENERATED=1
    else
      echo "!! 证书生成失败：caddy 将无法提供 HTTPS。请手动执行：bash $GEN --ca <服务器IP>"
    fi
  else
    echo "!! 未找到 $GEN：请手动放置 fullchain.pem/privkey.pem 到 $CERT_DIR_LOCAL"
  fi
fi

# ── 5. 启动 ──
if [ "$CMD" = "--env-only" ]; then
  echo "OK: 环境就绪（未启动）。运行 bash install.sh 启动"
  exit 0
fi

compose up -d

# 新生成的证书：bind mount 内容变化不会触发容器重建，需显式重载 caddy
if [ "$CERT_GENERATED" = "1" ] && docker ps --format '{{.Names}}' | grep -q "caddy"; then
  compose restart caddy
  echo "-> 已重载 caddy 加载新生成的证书"
fi
echo "OK: 已启动。默认账号 admin/123456（首次登录会要求修改密码）"
echo "    查看日志: docker-compose -p meeting logs -f   （注意必须带 -p meeting）"
echo "    停止: bash install.sh stop    卸载: bash install.sh down"
echo "    443 HTTPS 需要证书：bash deploy/docker/gen-selfsigned.sh --ca <服务器IP>"
