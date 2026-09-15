#!/usr/bin/env bash
# =============================================================================
# payload 基线校验：确认产物真的能在目标 glibc 上运行
#
# 两种模式（环境变量选择）：
#   MODE=symbols MAX_GLIBC=2.17  任意带 binutils 的容器内执行：
#                                断言 node / better-sqlite3 / mediasoup-worker
#                                的最高 GLIBC 符号版本 ≤ 目标基线
#   MODE=runtime                 目标基线容器内执行（x64 → centos:7，arm64 → debian:10）：
#                                真实加载三个原生件，缺库/符号不兼容会直接失败
#
# 用法：
#   MODE=symbols MAX_GLIBC=2.17 bash verify-payload.sh /payload/meeting-payload.tar.gz
#   MODE=runtime               bash verify-payload.sh /payload/meeting-payload.tar.gz
# =============================================================================
set -euo pipefail

PAYLOAD="${1:?usage: verify-payload.sh <payload.tar.gz>}"
MODE="${MODE:-runtime}"
MAX_GLIBC="${MAX_GLIBC:-}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$PAYLOAD" -C "$WORK"

NODE_BIN="$WORK/opt/meeting/runtime/bin/node"
APP_DIR="$WORK/opt/meeting/app"
if [ ! -x "$NODE_BIN" ]; then
  echo "ERROR: payload 里没有可执行的 Node 运行时：$NODE_BIN" >&2
  exit 1
fi

BS3="$(find "$APP_DIR" -name 'better_sqlite3.node' -type f 2>/dev/null | head -1 || true)"
WORKER="$(find "$APP_DIR" -name 'mediasoup-worker' -type f 2>/dev/null | head -1 || true)"

echo "→ 容器 glibc：$(ldd --version 2>/dev/null | head -1)"
echo "→ node      ：$NODE_BIN"
echo "→ sqlite    ：${BS3:-<未找到>}"
echo "→ worker    ：${WORKER:-<未找到>}"

# 取某个 ELF 里最高的 GLIBC_/GLIBCXX_ 版本号（去掉前缀）
# 注意：grep 无匹配时退出码为 1，在 set -euo pipefail 下会**直接中断整个脚本**，
# 而"没有 GLIBCXX 符号"恰恰是基线模式期望的结果（-static-libstdc++ 之后不再有
# 动态 GLIBCXX 符号）→ 曾把 better-sqlite3 误判成校验失败（node 打印完就退出）。
# 故此处显式兜底为空字符串。
highest() {
  objdump -T "$1" 2>/dev/null \
    | grep -o "$2_[0-9.]*" \
    | sort -Vu | tail -1 | sed "s/^$2_//" || true
}

# 某 ELF 依赖的动态库列表（用于说明 libstdc++ 是否已被静态链接）
needed() {
  objdump -p "$1" 2>/dev/null | awk '$1 == "NEEDED" { print $2 }' | tr '\n' ' '
}

# $1 <= $2 ?
le() {
  [ "$1" = "$2" ] && return 0
  [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ]
}

if [ "$MODE" = "symbols" ]; then
  [ -n "$MAX_GLIBC" ] || { echo "ERROR: symbols 模式必须提供 MAX_GLIBC" >&2; exit 1; }
  failed=0
  for f in "$NODE_BIN" "$BS3" "$WORKER"; do
    [ -n "$f" ] && [ -f "$f" ] || continue
    need="$(highest "$f" GLIBC)"
    cxx="$(highest "$f" GLIBCXX)"
    deps="$(needed "$f")"
    echo "  $(basename "$f"): GLIBC=${need:-无} GLIBCXX=${cxx:-无（已静态链接）}${deps:+ | NEEDED: $deps}"
    if [ -n "$need" ] && ! le "$need" "$MAX_GLIBC"; then
      echo "ERROR: $(basename "$f") 需要 GLIBC_$need > 基线 $MAX_GLIBC" >&2
      failed=1
    fi
  done
  [ "$failed" = "0" ] || exit 1
else
  # 1) Node 运行时不能有缺失的动态库
  if ldd "$NODE_BIN" 2>&1 | grep -qi "not found"; then
    echo "ERROR: Node 运行时依赖缺失：" >&2
    ldd "$NODE_BIN" | grep -i "not found" >&2
    exit 1
  fi
  echo "→ node -v: $("$NODE_BIN" -v)"

  # 2) better-sqlite3 原生模块能否真正加载
  if [ -z "$BS3" ]; then
    echo "ERROR: payload 里未找到 better_sqlite3.node" >&2
    exit 1
  fi
  "$NODE_BIN" -e "const m = { exports: {} }; process.dlopen(m, '$BS3'); console.log('→ better-sqlite3 原生模块加载 OK');"

  # 3) mediasoup worker 能否启动（--version 即可触发动态链接）
  if [ -z "$WORKER" ]; then
    echo "ERROR: payload 里未找到 mediasoup-worker" >&2
    exit 1
  fi
  chmod +x "$WORKER"
  echo "→ mediasoup-worker: $("$WORKER" --version)"
fi

echo "=== payload 校验通过（MODE=$MODE）==="
