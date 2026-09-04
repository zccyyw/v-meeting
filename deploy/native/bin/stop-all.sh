#!/usr/bin/env bash
set -euo pipefail
PREFIX="$(cd "$(dirname "$0")/.." && pwd)"
for name in api realtime gateway; do
  pidfile="$PREFIX/logs/$name.pid"
  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile")"
    kill "$pid" 2>/dev/null || true
    rm -f "$pidfile"
    echo "stopped $name ($pid)"
  fi
done
