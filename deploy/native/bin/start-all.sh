#!/usr/bin/env bash
set -euo pipefail
PREFIX="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PREFIX/conf/.env"
NODE="${NODE_BIN:-$PREFIX/bin/node}"
[[ -x "$NODE" ]] || NODE="$(command -v node)"

export FRONT_ROOT="$PREFIX/app/front"
export API_UPSTREAM="${API_UPSTREAM:-http://127.0.0.1:8080}"
export WS_UPSTREAM="${WS_UPSTREAM:-http://127.0.0.1:8082}"

mkdir -p "$PREFIX/logs"

cd "$PREFIX/app/serve/api"
"$NODE" --env-file="$ENV_FILE" dist/index.js >>"$PREFIX/logs/api.log" 2>>"$PREFIX/logs/api.err.log" &
echo $! >"$PREFIX/logs/api.pid"

cd "$PREFIX/app/serve/realtime"
"$NODE" --env-file="$ENV_FILE" dist/index.js >>"$PREFIX/logs/realtime.log" 2>>"$PREFIX/logs/realtime.err.log" &
echo $! >"$PREFIX/logs/realtime.pid"

cd "$PREFIX"
"$NODE" --env-file="$ENV_FILE" "$PREFIX/bin/gateway.mjs" >>"$PREFIX/logs/gateway.log" 2>>"$PREFIX/logs/gateway.err.log" &
echo $! >"$PREFIX/logs/gateway.pid"

echo "started api/realtime/gateway (pids in $PREFIX/logs/*.pid)"
