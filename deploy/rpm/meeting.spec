Name:           meeting
Version:        0.1
Release:        1%{?dist}
Summary:        Meet video conferencing system
License:        Proprietary
Vendor:         Meet
URL:            https://example.com
AutoReqProv:    no
BuildArch:      x86_64

# Disable automatic dependency scanning (node modules would cause false deps)
%global _use_internal_dependency_generator 0
%global __requires_exclude ^.*$
%global __provides_exclude ^.*$

%description
Meet video conferencing system with WebRTC SFU,
REST API, and real-time signaling.
Supports SQLite (zero-dependency), MySQL, and PostgreSQL.

%prep
# nothing (pre-built payload assembled by pack-rpm.mjs)

%install
# Payload is pre-assembled in buildroot by pack-rpm.mjs via fpm
# This spec is used as a template; actual build uses fpm --after-install etc.

%files
/opt/meeting
/usr/lib/systemd/system/meeting-api.service
/usr/lib/systemd/system/meeting-realtime.service
/usr/lib/systemd/system/meeting-gateway.service
%config(noreplace) /opt/meeting/conf/env.example

%pre
# Create system user if not exists
if ! id meeting >/dev/null 2>&1; then
    useradd --system --home-dir /opt/meeting --shell /sbin/nologin meeting 2>/dev/null || true
fi

%post
# Refresh systemd after install
systemctl daemon-reload 2>/dev/null || true

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
echo "                 (or http:// if no cert)"
echo ""
echo "  Default login: admin / admin123"
echo ""

%preun
# Stop services before uninstall
if [ $1 -eq 0 ]; then
    systemctl --no-block stop meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
    systemctl disable meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
fi

%postun
# Refresh systemd after uninstall
if [ $1 -eq 0 ]; then
    systemctl daemon-reload 2>/dev/null || true
fi

%changelog
* Fri Jul 31 2026 Meet <meet@example.com> - 0.1-1
- Initial RPM release
- Supports SQLite (default), MySQL, PostgreSQL
- Bundled Node.js runtime (no external Node.js needed)
- In-memory Redis fallback (no external Redis needed for single-node)
- Pure-JS certificate generation (no OpenSSL needed)
