#!/usr/bin/env bash
# 阈值纯函数库（可被 source；不执行任何 IO）
# 公式来源：docs/design/服务器资源监控采集器设计方案.md §5.3
# 内存按 MemAvailable 判断；warn = avail<A 或 used%≥75；crit = avail<C
# 磁盘同理，百分比线为 80%
set -u

max() { [ "$1" -gt "$2" ] && echo "$1" || echo "$2"; }
min() { [ "$1" -lt "$2" ] && echo "$1" || echo "$2"; }

_A_MEM_FLOOR=2097152   # 2G
_A_MEM_CAP=4194304     # 4G
_C_MEM_FLOOR=524288    # 512M
_C_MEM_CAP=2097152     # 2G
_A_DSK_FLOOR=2097152   # 2G
_A_DSK_CAP=10485760    # 10G
_C_DSK_FLOOR=524288    # 512M
_C_DSK_CAP=2097152     # 2G

# compute_mem_thresholds TOTAL_KB → 输出 "WARN_KB CRIT_KB"
compute_mem_thresholds() {
  local total="$1" a c
  a=$(max "$_A_MEM_FLOOR" "$(min "$_A_MEM_CAP" "$((total * 20 / 100))")")
  c=$(max "$_C_MEM_FLOOR" "$(min "$_C_MEM_CAP" "$((total * 5 / 100))")")
  echo "$a $c"
}

# compute_disk_thresholds TOTAL_KB → 输出 "WARN_KB CRIT_KB"
compute_disk_thresholds() {
  local total="$1" a c
  a=$(max "$_A_DSK_FLOOR" "$(min "$_A_DSK_CAP" "$((total * 20 / 100))")")
  c=$(max "$_C_DSK_FLOOR" "$(min "$_C_DSK_CAP" "$((total * 10 / 100))")")
  echo "$a $c"
}

# classify_mem_state AVAIL_KB TOTAL_KB → 输出 ok|warn|crit
classify_mem_state() {
  local avail="$1" total="$2" a c used_pct
  read -r a c <<< "$(compute_mem_thresholds "$total")"
  used_pct=$(( (total - avail) * 100 / total ))
  if [ "$avail" -lt "$c" ]; then echo "crit"
  elif [ "$avail" -lt "$a" ] || [ "$used_pct" -ge 75 ]; then echo "warn"
  else echo "ok"; fi
}

# classify_disk_state AVAIL_KB TOTAL_KB → 输出 ok|warn|crit
classify_disk_state() {
  local avail="$1" total="$2" a c used_pct
  read -r a c <<< "$(compute_disk_thresholds "$total")"
  used_pct=$(( (total - avail) * 100 / total ))
  if [ "$avail" -lt "$c" ]; then echo "crit"
  elif [ "$avail" -lt "$a" ] || [ "$used_pct" -ge 80 ]; then echo "warn"
  else echo "ok"; fi
}
