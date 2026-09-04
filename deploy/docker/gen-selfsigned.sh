#!/usr/bin/env bash
# ====================================================================
# 生成 TLS 证书 for Caddy（/certs 挂载点）
#
# 模式一（默认）: 自签证书 — 适合内网测试，浏览器手动信任
# 模式二（--ca）: 根 CA 签发 — 适合信创涉密环境，根 CA 导入后自动信任
#
# 用法：
#   # 模式一：自签
#   bash gen-selfsigned.sh 192.168.1.100
#
#   # 模式二：CA 签发（信创环境推荐）
#   bash gen-selfsigned.sh --ca 192.168.1.100
#   → 输出 ca.crt（导入信任库）+ fullchain.pem + privkey.pem（部署）
#
# 产物目录：deploy/docker/certs/
# ====================================================================
set -euo pipefail

USE_CA=false
if [[ "${1:-}" == "--ca" ]]; then
  USE_CA=true
  shift
fi

HOST="${1:?usage: $0 [--ca] <ip-or-dns>}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$ROOT/certs"
mkdir -p "$DIR"
umask 077

# Build subjectAltName
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:${HOST},IP:127.0.0.1,DNS:localhost"
else
  SAN="DNS:${HOST},DNS:localhost,IP:127.0.0.1"
fi

CNF="$(mktemp)"
trap 'rm -f "$CNF"' EXIT

if $USE_CA; then
  # ========== 模式二：根 CA 签发 ==========
  echo "=== CA 签发模式（信创环境推荐）==="

  # 1. 根 CA
  if [ ! -f "$DIR/ca.key" ]; then
    echo "[1/5] 生成根 CA 私钥..."
    openssl genrsa -out "$DIR/ca.key" 4096
  fi
  if [ ! -f "$DIR/ca.crt" ]; then
    echo "[2/5] 生成根 CA 证书..."
    openssl req -x509 -new -nodes -key "$DIR/ca.key" -sha256 -days 3650 \
      -out "$DIR/ca.crt" \
      -subj "/C=CN/ST=Beijing/L=Beijing/O=Meeting-CA/OU=Security/CN=Meeting-Root-CA" \
      -addext "basicConstraints=critical,CA:TRUE" \
      -addext "keyUsage=critical,keyCertSign,cRLSign"
  fi

  # 2. 服务器 CSR
  echo "[3/5] 生成服务器私钥与 CSR..."
  openssl genrsa -out "$DIR/server.key" 2048

  cat > "$CNF" <<EOF
[req]
distinguished_name = dn
prompt = no

[dn]
C = CN
ST = Beijing
L = Beijing
O = Meeting
CN = ${HOST}

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${SAN}
EOF
  openssl req -new -key "$DIR/server.key" -out "$DIR/server.csr" -config "$CNF"

  # 3. CA 签发
  echo "[4/5] 根 CA 签发服务器证书..."
  openssl x509 -req -in "$DIR/server.csr" \
    -CA "$DIR/ca.crt" -CAkey "$DIR/ca.key" -CAcreateserial \
    -out "$DIR/server.crt" -days 825 -sha256 \
    -extensions v3_req -extfile "$CNF"

  # 4. 合并证书链
  echo "[5/5] 生成 fullchain.pem..."
  cat "$DIR/server.crt" "$DIR/ca.crt" > "$DIR/fullchain.pem"
  cp "$DIR/server.key" "$DIR/privkey.pem"

  chmod 644 "$DIR/ca.crt" "$DIR/fullchain.pem" "$DIR/server.crt"
  chmod 600 "$DIR/privkey.pem" "$DIR/ca.key" "$DIR/server.key"

  echo ""
  echo "=== 完成 ==="
  echo "  ca.crt         → 导入客户端浏览器/系统根信任机构"
  echo "  fullchain.pem  → Caddy 服务器证书"
  echo "  privkey.pem    → Caddy 服务器私钥"
  echo "  Next: docker compose ... up -d --force-recreate caddy"
else
  # ========== 模式一：自签 ==========
  echo "=== 自签模式（内网测试用）==="

  cat > "$CNF" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no

[dn]
C = CN
ST = Beijing
L = Beijing
O = Meeting
CN = ${HOST}

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = ${SAN}
EOF

  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$DIR/privkey.pem" \
    -out "$DIR/fullchain.pem" \
    -config "$CNF"

  chmod 644 "$DIR/fullchain.pem"
  chmod 600 "$DIR/privkey.pem"
  echo "OK: $DIR/fullchain.pem"
  echo "OK: $DIR/privkey.pem"
  echo "Next: docker compose ... up -d --force-recreate caddy"
  echo ""
  echo "提示: 信创环境请用 --ca 模式: bash $0 --ca $HOST"
fi
