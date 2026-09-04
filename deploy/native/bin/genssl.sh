#!/bin/bash
set -euo pipefail

# ====================================================================
# 信创环境 CA 根证书 + 服务器 IP 证书生成脚本
#
# 依赖：OpenSSL（麒麟/UOS/中科方德系统自带）
#
# 用途：涉密客户端浏览器不允许直接信任自签名证书，
#       需要先生成根 CA 证书并导入浏览器/系统信任库，
#       再由根 CA 签发带 IP SAN 的服务器证书。
#
# 用法：
#   bash genssl.sh <服务器IP> [输出目录]
#   示例：bash genssl.sh 192.168.1.100
#   示例：bash genssl.sh 10.0.0.5 /opt/meeting/certs
#
# 默认输出目录：/opt/meeting/certs（离线包安装后的证书目录）
#
# 产物：
#   ca.crt          — 根 CA 证书（需导入浏览器/系统信任库）
#   ca.key          — 根 CA 私钥（妥善保管，泄露则全部证书失效）
#   fullchain.pem   — 服务器证书链（= server.crt + ca.crt，部署用）
#   privkey.pem     — 服务器私钥（部署用）
#   server.crt      — 服务器证书（单独）
#   server.key      — 服务器私钥（单独）
#
# 部署步骤：
#   1. 将 ca.crt 导入客户端浏览器/系统根信任机构
#   2. fullchain.pem 和 privkey.pem 已在输出目录，可直接使用
#   3. 重启 Web 服务：
#      - gateway 方式：sudo systemctl restart meeting-gateway
#      - nginx 方式：sudo nginx -t && sudo systemctl reload nginx
# ====================================================================

HOST="${1:?用法: $0 <服务器IP> [输出目录]}"
OUT_DIR="${2:-/opt/meeting/certs}"

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

# ---------- 0. 检查 openssl ----------
command -v openssl >/dev/null 2>&1 || {
  echo "ERROR: 未找到 openssl，请先安装（麒麟/UOS: yum install openssl）"
  exit 1
}

# ---------- 1. 生成根 CA 私钥与自签根证书 ----------
if [ ! -f ca.key ]; then
  echo "[1/5] 生成根 CA 私钥 (RSA 4096)..."
  openssl genrsa -out ca.key 4096
fi

if [ ! -f ca.crt ]; then
  echo "[2/5] 生成根 CA 自签证书 (10年)..."
  # 兼容老版本 OpenSSL（不支持 -addext 的用配置文件方式）
  if openssl req -help 2>&1 | grep -q -- '-addext'; then
    openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
      -out ca.crt \
      -subj "/C=CN/ST=Beijing/L=Beijing/O=Meeting-CA/OU=Security/CN=Meeting-Root-CA" \
      -addext "basicConstraints=critical,CA:TRUE" \
      -addext "keyUsage=critical,keyCertSign,cRLSign"
  else
    # 老版本 OpenSSL（如 CentOS 7.6 的 OpenSSL 1.0.2）不支持 -addext
    CA_CNF="$(mktemp)"
    cat > "$CA_CNF" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3_ca
prompt = no

[dn]
C = CN
ST = Beijing
L = Beijing
O = Meeting-CA
OU = Security
CN = Meeting-Root-CA

[v3_ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
EOF
    openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
      -out ca.crt -config "$CA_CNF" -extensions v3_ca
    rm -f "$CA_CNF"
  fi
fi

# ---------- 2. 生成服务器私钥 ----------
echo "[3/5] 生成服务器私钥 (RSA 2048)..."
openssl genrsa -out server.key 2048

# ---------- 3. 生成服务器 CSR + SAN 扩展配置 ----------
CNF="$(mktemp)"
trap 'rm -f "$CNF"' EXIT

if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:${HOST},IP:127.0.0.1,DNS:localhost"
else
  SAN="DNS:${HOST},DNS:localhost,IP:127.0.0.1"
fi

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

openssl req -new -key server.key -out server.csr -config "$CNF"

# ---------- 4. 根 CA 签发服务器证书 ----------
echo "[4/5] 根 CA 签发服务器证书 (825天)..."
openssl x509 -req -in server.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 825 -sha256 \
  -extensions v3_req -extfile "$CNF"

# ---------- 5. 合并证书链 ----------
echo "[5/5] 生成 fullchain.pem (服务器证书 + 根 CA 证书)..."
cat server.crt ca.crt > fullchain.pem

# 权限
chmod 600 ca.key server.key
cp server.key privkey.pem
chmod 600 privkey.pem
chmod 644 ca.crt server.crt fullchain.pem

# ---------- 输出 ----------
echo ""
echo "===== 证书生成完成 ====="
echo "输出目录: $(pwd)"
echo ""
echo "  ca.crt         — 根 CA 证书（导入浏览器信任库）"
echo "  fullchain.pem  — 服务器证书链（已就位）"
echo "  privkey.pem    — 服务器私钥（已就位）"
echo ""
echo "===== SAN 校验 ====="
openssl x509 -in server.crt -text -noout | grep -A5 "Subject Alternative Name"
echo ""
echo "===== 下一步 ====="
echo "1. 将 ca.crt 复制到各信创客户端，导入浏览器/系统根信任机构"
echo "2. 重启 Web 服务："
echo "   gateway: sudo systemctl restart meeting-gateway"
echo "   nginx:   sudo nginx -t && sudo systemctl reload nginx"
