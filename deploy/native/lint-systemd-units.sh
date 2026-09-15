#!/usr/bin/env bash
# =============================================================================
# systemd 单元兼容性校验（目标最低版本 = systemd 219，银河麒麟 V10 SP1）
#
# 校验三件事：
#   1) 不得使用 StandardOutput=/StandardError=append:（需 systemd >= 240，
#      219/239 直接报错、服务起不来）
#   2) 只允许 systemd 219 已支持的指令（白名单），防止后续加入 240+ 指令
#   3) 使用 AmbientCapabilities（需 >= 229）时，安装脚本必须有 setcap 兜底
#      （219 上该指令被当作未知键忽略，443 绑定能力只能靠 setcap）
#
# 用法：bash deploy/native/lint-systemd-units.sh
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIRS=(
  "$ROOT/deploy/native/systemd"
  "$ROOT/deploy/native/systemd-rpm"
)

# systemd 219 支持的指令（Unit / Service / Install 合并白名单）
ALLOWED='Description|Documentation|After|Before|Wants|Requires|PartOf|Alias|Type|User|Group|WorkingDirectory|EnvironmentFile|Environment|ExecStart|ExecStartPre|ExecStartPost|ExecStop|ExecReload|Restart|RestartSec|TimeoutStartSec|TimeoutStopSec|LimitNOFILE|AmbientCapabilities|CapabilityBoundingSet|WantedBy|RequiredBy'

failed=0
shopt -s nullglob
units=()
for d in "${DIRS[@]}"; do
  if [ ! -d "$d" ]; then
    echo "ERROR: 目录不存在：$d" >&2
    exit 1
  fi
  for f in "$d"/*.service; do
    units+=("$f")
  done
done
if [ "${#units[@]}" -eq 0 ]; then
  echo "ERROR: 未找到任何 .service 单元" >&2
  exit 1
fi

echo "→ 校验 ${#units[@]} 个 systemd 单元（基线 systemd 219）"

for f in "${units[@]}"; do
  rel="${f#"$ROOT"/}"

  # 1) append: 在 219/239 上不支持
  if grep -qE '^(StandardOutput|StandardError)=append:' "$f"; then
    echo "  ✗ $rel 使用了 StandardOutput/StandardError=append:（需 systemd >= 240）" >&2
    failed=1
  fi

  # 2) 指令白名单
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    if ! printf '%s' "$key" | grep -Eq "^(${ALLOWED})$"; then
      echo "  ✗ $rel 含非 219 兼容指令：$key" >&2
      failed=1
    fi
  done < <(grep -oE '^[A-Za-z][A-Za-z0-9]*=' "$f" | tr -d '=' | sort -u)

  # 3) AmbientCapabilities 必须配套 setcap 兜底
  if grep -qE '^AmbientCapabilities=' "$f"; then
    for script in "$ROOT/deploy/rpm/post.sh" "$ROOT/deploy/native/install.sh"; do
      if ! grep -q 'setcap' "$script"; then
        echo "  ✗ $rel 依赖 AmbientCapabilities，但 $(basename "$script") 缺少 setcap 兜底" >&2
        failed=1
      fi
    done
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "systemd 单元校验失败（目标基线 systemd 219）" >&2
  exit 1
fi
echo "✓ systemd 单元校验通过（systemd 219 兼容）"
