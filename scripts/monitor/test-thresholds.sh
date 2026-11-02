#!/usr/bin/env bash
# 阈值公式单元测试（纯 bash 断言，无框架依赖）
# 期望值来源：docs/design/服务器资源监控采集器设计方案.md §5.3/§5.4（bash 实算验证）
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/monitor-thresholds.sh"

pass=0; fail=0
assert_eq() { # desc expect actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1 expect=[$2] actual=[$3]"; fi
}

# ── compute_mem_thresholds：total_kb → "A C" ──
assert_eq "mem 4G"   "2097152 524288"  "$(compute_mem_thresholds 4194304)"
assert_eq "mem 8G"   "2097152 524288"  "$(compute_mem_thresholds 8388608)"
assert_eq "mem 64G"  "4194304 2097152" "$(compute_mem_thresholds 67108864)"

# ── compute_disk_thresholds：total_kb → "A C" ──
assert_eq "disk 40G"  "8388608 2097152"  "$(compute_disk_thresholds 41943040)"
assert_eq "disk 100G" "10485760 2097152" "$(compute_disk_thresholds 104857600)"
assert_eq "disk 1T"   "10485760 2097152" "$(compute_disk_thresholds 1073741824)"

# ── classify_mem_state：avail_kb total_kb → ok|warn|crit ──
# 4G 机器：avail 3G（used 25%）→ ok；avail 1G（used 75%，A=2G）→ warn；avail 256M（C=512M）→ crit
assert_eq "mem 4G used25%"  "ok"   "$(classify_mem_state 3145728 4194304)"
assert_eq "mem 4G used75%"  "warn" "$(classify_mem_state 1048576 4194304)"
assert_eq "mem 4G avail<crit" "crit" "$(classify_mem_state 262144 4194304)"
# 64G 机器：avail 12G（used 81%，百分比线触发 warn；C=2G 不 crit）
assert_eq "mem 64G used81%" "warn" "$(classify_mem_state 12582912 67108864)"
# 64G 机器：avail 20G（used 69%）→ ok（大机器常态不误报）
assert_eq "mem 64G used69%" "ok"   "$(classify_mem_state 20971520 67108864)"

# ── classify_disk_state：avail_kb total_kb → ok|warn|crit ──
# 100G 盘：avail 5G（used 95%，A=10G）→ warn；avail 1G（C=2G）→ crit；avail 50G → ok
assert_eq "disk 100G used95%" "warn" "$(classify_disk_state 5242880 104857600)"
assert_eq "disk 100G avail<crit" "crit" "$(classify_disk_state 1048576 104857600)"
assert_eq "disk 100G used50%" "ok"   "$(classify_disk_state 52428800 104857600)"
# 大盘百分比线：1T 盘 used 85%（avail 150G > A=10G）→ warn 仅由百分比触发
assert_eq "disk 1T used85%" "warn" "$(classify_disk_state 157286400 1073741824)"

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
