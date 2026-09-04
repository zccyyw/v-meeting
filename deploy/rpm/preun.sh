#!/bin/sh
# RPM %preun script — runs before package uninstall

if [ $1 -eq 0 ]; then
    systemctl --no-block stop meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
    systemctl disable meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
fi
