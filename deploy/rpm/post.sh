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

echo ""
echo "Meet installed to /opt/meeting"
echo "Configure: sudo /opt/meeting/runtime/bin/node /opt/meeting/bin/configure.mjs"
echo "Start:     sudo systemctl enable --now meeting-api meeting-realtime meeting-gateway"
echo ""
