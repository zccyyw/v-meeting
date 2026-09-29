#!/usr/bin/env bash
# Meeting Docker 一键安装引导
#
#   1. .env 不存在时从 env.example 生成；已存在则完整保留用户配置
#   2. 机密类参数自动生成（幂等：已有真实值绝不覆盖）：
#        - MEETING_CRYPTO_KEY   密码传输加密密钥（openssl rand -base64 32）
#        - MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD / REDIS_PASSWORD
#        - POSTGRES_PASSWORD（仅 postgres profile）
#      仅当值缺失/为空/仍是模板占位值时生成；compose 中容器初始化与服务连接
#      共用同一变量，自动生成的值两端天然一致，无需手工同步
#   3. MEDIASOUP_ANNOUNCED_IP 自动探测本机对外 IP 写入默认值（跨 NAT 部署
#      需公网 IP，脚本无法可靠判断，会打印醒目提示请人工确认）
#   4. docker compose up -d 启动（SKIP_UP=1 或 --env-only 仅准备环境不启动）
#
# 用法：
#   bash install.sh                 # 准备 .env 并启动
#   bash install.sh --env-only      # 仅准备 .env，不启动
#   SKIP_UP=1 bash install.sh       # 同上
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

ENV_FILE=".env"
EXAMPLE="env.example"

# ── 1. .env 不存在则从模板创建 ──
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

# ── 2. 随机串生成：优先 openssl，无则 /dev/urandom 兜底 ──
gen_secret() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -d '\n'
  else
    head -c "$bytes" /dev/urandom | base64 | tr -d '\n'
  fi
}

# 幂等写入：删除所有（含注释的）旧行后追加一条真实值。
# 生成的 base64 字符集（A-Za-z0-9+/=）不含特殊字符，可安全拼入。
set_env_value() {
  local key="$1" val="$2"
  if grep -qE "^\s*#?\s*${key}=" "$ENV_FILE"; then
    grep -vE "^\s*#?\s*${key}=" "$ENV_FILE" > "$ENV_FILE.tmp" \
      && printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE.tmp" \
      && mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

# 读取某 key 的当前生效值（最后一个未注释行）
get_env_value() {
  grep -E "^${1}=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '"' || true
}

# 机密参数：值为空或命中占位值列表时自动生成
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

# ── 3. MEDIASOUP_ANNOUNCED_IP 自动探测（占位值时）──
detect_announced_ip() {
  # 优先取默认路由出口 IP；退而取 hostname -I 第一个地址
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

# ── 4. 启动 ──
if [ "${SKIP_UP:-0}" = "1" ] || [ "${1:-}" = "--env-only" ]; then
  echo "OK: 环境就绪（未启动）。运行 docker compose up -d 启动"
  exit 0
fi

if docker compose version >/dev/null 2>&1; then
  docker compose -p meeting up -d
elif command -v docker-compose >/dev/null 2>&1; then
  docker-compose -p meeting up -d
else
  echo "!! 未找到 docker compose / docker-compose，请先安装 Docker Compose v2+" >&2
  exit 1
fi

echo "OK: 已启动。默认账号 admin/admin123（首次登录会要求修改密码）"
echo "    443 HTTPS 需要证书：bash deploy/docker/gen-selfsigned.sh --ca <服务器IP>"
