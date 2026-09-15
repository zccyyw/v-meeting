#!/bin/sh
# RPM %post script — runs after package install/upgrade
# Kept minimal: only daemon-reload (no .sh execution by user)

systemctl daemon-reload 2>/dev/null || true

# Create meeting user if %pre didn't run (defensive)
if ! id meeting >/dev/null 2>&1; then
    useradd --system --home-dir /opt/meeting --shell /sbin/nologin meeting 2>/dev/null || true
fi

# Ensure directories exist with correct ownership
mkdir -p /opt/meeting/logs /opt/meeting/data /opt/meeting/certs
chown -R meeting:meeting /opt/meeting 2>/dev/null || true

# 网关默认监听 443（特权端口）：授予运行时 node 绑定低位端口能力
# （systemd ≥ 229 由单元 AmbientCapabilities 覆盖；此处兜底旧版 systemd）
if command -v setcap >/dev/null 2>&1; then
    setcap 'cap_net_bind_service=+ep' /opt/meeting/runtime/bin/node 2>/dev/null || true
fi

# 升级时若服务已在运行，自动重启以加载新版本
# （首次安装因尚未配置 .env，服务未启用，is-active 为假，不会误重启）
if [ -d /run/systemd/system ] && systemctl is-active --quiet meeting-api 2>/dev/null; then
    systemctl restart meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
fi

echo ""
echo "Meet installed to /opt/meeting"
echo "Configure: sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs"
echo "Start:     sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway"
echo ""
