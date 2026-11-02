#!/usr/bin/env bash
# meeting-monitor.sh — Meeting 服务器资源监控采集器
# 设计：docs/design/服务器资源监控采集器设计方案.md
# 用法：
#   meeting-monitor.sh          常驻采集（默认 15s 一轮）
#   meeting-monitor.sh --once   采集两轮后退出（冒烟/调试；两轮为获得 CPU 差分）
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=monitor-thresholds.sh
source "$SCRIPT_DIR/monitor-thresholds.sh" \
  || { echo "!! 缺少 $SCRIPT_DIR/monitor-thresholds.sh，无法启动监控" >&2; exit 1; }

MON_DIR="${MONITOR_DIR:-$PWD/logs/monitor}"
INTERVAL="${MONITOR_INTERVAL:-15}"
FAST_INTERVAL=2        # 触发后细采样间隔
FAST_DURATION=600      # 细采样持续 10 分钟
METRICS_KEEP_DAYS="${LOG_RETENTION_DAYS:-15}"
SNAPSHOT_KEEP_DAYS=30
EXCLUDE_FS_RE='^(tmpfs|devtmpfs|udev|overlay|squashfs|shm|nsfs|ramfs)'

ONCE=0; [ "${1:-}" = "--once" ] && ONCE=1

mkdir -p "$MON_DIR/snapshots" 2>/dev/null
STATE_FILE="$MON_DIR/.state"
METRICS_FILE=""; EVENTS_FILE=""

# ── 基础 ──
now_epoch() { date +%s; }
now_iso()   { date '+%Y-%m-%dT%H:%M:%S%z'; }
boot_id()   { cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo "unknown"; }
json_escape() { printf '%s' "$1" | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g'; }
append_line() { printf '%s\n' "$1" >> "$2"; }
state_get()   { grep -F "$1=" "$STATE_FILE" 2>/dev/null | tail -1 | cut -d= -f2-; }
state_set() { # 读-改-写单行：高频键（每轮 rc_* / epoch / strikes）否则 .state 无限增长
  local key="$1" val="$2"
  if [ -f "$STATE_FILE" ] && grep -q "^${key}=" "$STATE_FILE" 2>/dev/null; then
    grep -v "^${key}=" "$STATE_FILE" > "$STATE_FILE.tmp" 2>/dev/null || true
    printf '%s=%s\n' "$key" "$val" >> "$STATE_FILE.tmp"
    mv "$STATE_FILE.tmp" "$STATE_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >> "$STATE_FILE"
  fi
}

emit_event() { # TYPE LEVEL DETAIL_JSON(可选)
  # 注意不能写 ${3:-{}}：bash 会把默认值解析为 "{" 再跟一个字面 "}"，
  # 有 detail 时会多出一个 "}" 产出非法 JSON
  local detail="${3:-"{}"}"
  append_line "{\"ts\":\"$(now_iso)\",\"type\":\"$1\",\"level\":\"${2:-info}\",\"detail\":${detail}}" "$EVENTS_FILE"
}

ensure_day_files() { # 参数=YYYYMMDD
  local want="metrics-$1.jsonl"
  if [ "$METRICS_FILE" != "$MON_DIR/$want" ]; then
    METRICS_FILE="$MON_DIR/metrics-$1.jsonl"
    EVENTS_FILE="$MON_DIR/events-$1.jsonl"
  fi
}

# ── 系统指标 ──
MEM_TOTAL_KB=0; MEM_AVAIL_KB=0; SWAP_USED_KB=0
read_meminfo() {
  local k v
  MEM_TOTAL_KB=0; MEM_AVAIL_KB=0
  while read -r k v _; do
    case "$k" in
      MemTotal:)     MEM_TOTAL_KB=$v ;;
      MemAvailable:) MEM_AVAIL_KB=$v ;;
      SwapTotal:)    SWAP_TOTAL=$v ;;
      SwapFree:)     SWAP_FREE=$v ;;
    esac
  done < /proc/meminfo
  SWAP_USED_KB=$(( ${SWAP_TOTAL:-0} - ${SWAP_FREE:-0} ))
}

LOAD1=0
read_loadavg() { LOAD1=$(cut -d' ' -f1 /proc/loadavg 2>/dev/null || echo 0); }

NPROC="$(nproc 2>/dev/null || echo 1)"
CPU_PREV=""; CPU_PCT=""
cpu_used_pct() { # 与上轮差分；直接设置全局 CPU_PCT（命令替换子 shell 内的赋值对父不可见，故不走 $()）
  local cur used total
  CPU_PCT=""
  cur=$(awk '/^cpu /{print $2+$3+$4+$6+$7+$8, $2+$3+$4+$5+$6+$7+$8}' /proc/stat 2>/dev/null) || return 0
  if [ -z "$CPU_PREV" ]; then CPU_PREV="$cur"; return 0; fi
  used=$(( ${cur%% *} - ${CPU_PREV%% *} ))
  total=$(( ${cur##* } - ${CPU_PREV##* } ))
  CPU_PREV="$cur"
  [ "$total" -le 0 ] && return 0
  CPU_PCT=$(( used * 100 / total ))
}

# 每分区输出 "mount|total_kb|avail_kb|used_pct"；inode 单独
# 挂载点可能含空格（如 Windows Git Bash 环境）：第 6 列起全部视为挂载点
get_disks() {
  df -P -k 2>/dev/null | awk -v ex="$EXCLUDE_FS_RE" 'NR>1 && $1 !~ ex {
    pct=$5; sub(/%/,"",pct); m=$6; for(i=7;i<=NF;i++) m=m" "$i
    print m"|"$2"|"$4"|"pct
  }'
}
get_disk_inodes() { # mount|inode_used_pct
  df -iP 2>/dev/null | awk -v ex="$EXCLUDE_FS_RE" 'NR>1 && $1 !~ ex {
    pct=$5; sub(/%/,"",pct); m=$6; for(i=7;i<=NF;i++) m=m" "$i
    print m"|"pct
  }'
}

get_top_mem()  { ps aux 2>/dev/null | sort -k6 -rn | head -6 | tail -5 \
                 | awk '{printf "%s:%sKB:%.60s ", $2, $6, $11}'; }
get_top_cpu()  { ps aux 2>/dev/null | sort -k3 -rn | head -6 | tail -5 \
                 | awk '{printf "%s:%s%%:%.60s ", $2, $3, $11}'; }
get_tcp_estab() { # ss 缺失/失败/非数字时输出 -1（管道退出码来自末段 awk，不能靠 || 兜底）
  local v
  v=$(ss -s 2>/dev/null | awk '/TCP:/{print $2; exit}')
  case "$v" in ''|*[!0-9]*) echo -1 ;; *) echo "$v" ;; esac
}
get_uptime_s()  { awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0; }

# ── 采样落盘 ──
collect_disks_json() { # → 逗号分隔的多分区 JSON 片段
  local out="" m total avail pct sep="" inode_table row inode_pct
  inode_table="$(get_disk_inodes)"   # 一次取全表，避免每分区每轮各跑一次 df 子进程
  while IFS='|' read -r m total avail pct; do
    [ -z "$m" ] && continue
    # 脏输入防御：total/avail/pct 必须为纯数字，否则跳过该分区（防坏 JSON 落盘）
    case "$total$avail$pct" in ''|*[!0-9]*) continue ;; esac
    inode_pct=0
    row="$(printf '%s\n' "$inode_table" | grep -F "$m|" | head -1)"
    row="${row##*|}"
    case "$row" in [0-9]*) inode_pct="$row" ;; esac
    out="$out$sep{\"m\":\"$(json_escape "$m")\",\"total_kb\":$total,\"avail_kb\":$avail,\"used_pct\":$pct,\"inode_pct\":$inode_pct}"
    sep=","
  done < <(get_disks)
  printf '%s' "$out"
}

write_metrics_sample() { # $1=cpu_pct(可空) $2=docker_json(可空=null)
  local ts cpu="$1" docker_json="${2:-null}" disks
  ts="$(now_iso)"
  disks="$(collect_disks_json)"
  append_line "{\"ts\":\"$ts\",\"boot\":\"$(boot_id)\",\"uptime_s\":$(get_uptime_s),\"cpu_pct\":${cpu:-null},\"load1\":$LOAD1,\"nproc\":$NPROC,\"mem_total_kb\":$MEM_TOTAL_KB,\"mem_avail_kb\":$MEM_AVAIL_KB,\"swap_used_kb\":$SWAP_USED_KB,\"disks\":[$disks],\"tcp_estab\":$(get_tcp_estab),\"top_mem\":\"$(json_escape "$(get_top_mem)")\",\"top_cpu\":\"$(json_escape "$(get_top_cpu)")\",\"docker\":$docker_json}" "$METRICS_FILE"
}

# ── 容器指标 ──
have_docker() { command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; }

collect_docker_json() { # → JSON 数组；docker 不可用输出 null（降级）
  have_docker || { echo "null"; return; }
  local out="[" row name cpu mempct rc oom state sep="" any=0
  while IFS=$'\t' read -r name cpu mempct; do
    [ -z "$name" ] && continue
    row="$(docker inspect --format '{{.RestartCount}} {{.State.OOMKilled}} {{.State.Status}}' "$name" 2>/dev/null || echo '0 false unknown')"
    read -r rc oom state <<< "$row"
    case "$rc" in ''|*[!0-9]*) rc=0 ;; esac
    # 重启/OOM 检测：与 .state 中的上次值比对，变化则发事件
    detect_container_event "$name" "$rc" "$oom"
    out="$out$sep{\"name\":\"$(json_escape "$name")\",\"cpu_pct\":\"$cpu\",\"mem_pct\":\"$mempct\",\"restarts\":$rc,\"oom_killed\":$oom,\"state\":\"$state\"}"
    sep=","
    any=1
  # tr -d '\r'：Windows/Docker Desktop 下 stats 输出为 CRLF，\r 混入 JSON 字符串致其非法
  done < <(docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemPerc}}' 2>/dev/null | tr -d '\r')
  [ "$any" -eq 0 ] && { echo "null"; return; }
  echo "$out]"
}

detect_container_event() { # NAME RESTARTS OOMKILLED(bool)
  local key="rc_$(printf '%s' "$1" | tr -c 'A-Za-z0-9_' _)"
  local prev; prev="$(state_get "$key")"
  state_set "$key" "$2|$3"
  [ -z "$prev" ] && return 0          # 首次记录基线
  [ "$prev" = "$2|$3" ] && return 0   # 无变化
  # RestartCount 增加或 OOMKilled 均为 crit（spec §5.3）
  emit_event container_event "crit" "{\"name\":\"$(json_escape "$1")\",\"restarts\":$2,\"oom_killed\":$3,\"prev\":\"$prev\"}"
}

# ── 阈值评估与快照 ──
snapshot_now() { # $1=reason
  local dir="$MON_DIR/snapshots/$(date +%Y%m%dT%H%M%S)-$1"
  mkdir -p "$dir" 2>/dev/null || return 0
  dmesg -T 2>/dev/null | tail -200 > "$dir/dmesg-tail.txt" \
    || journalctl -k -n 200 --no-pager > "$dir/dmesg-tail.txt" 2>/dev/null
  journalctl -k --no-pager 2>/dev/null | grep -iE 'oom|out of memory' \
    > "$dir/journalctl-oom.txt" || true
  ps aux --sort=-rss  2>/dev/null | head -11 > "$dir/top-mem.txt"
  ps aux --sort=-%cpu 2>/dev/null | head -11 > "$dir/top-cpu.txt"
  df -P -k  > "$dir/df.txt" 2>/dev/null
  df -iP    > "$dir/df-inode.txt" 2>/dev/null
  ss -s     > "$dir/ss-summary.txt" 2>/dev/null
  if have_docker; then
    docker stats --no-stream > "$dir/docker-stats.txt" 2>/dev/null
    docker ps -a             > "$dir/docker-ps.txt" 2>/dev/null
  fi
  emit_event snapshot_taken info "{\"reason\":\"$1\",\"dir\":\"$(basename "$dir")\"}"
}

handle_alert() { # $1=level $2=reason $3=detail_json $4=冷却key后缀(可选，如转义后的挂载点)
  local level="$1" reason="$2" now key last
  [ "$level" = "ok" ] && return 0
  now="$(now_epoch)"
  # 冷却 key 带后缀：不同磁盘的告警互不压制冷却期
  key="snap_${reason}${4:+_$(printf '%s' "$4" | tr -c 'A-Za-z0-9_' _)}"
  last="$(state_get "$key")"
  # 冷却期：同类告警 30 分钟内不重抓快照（事件仍记录）
  if [ -z "$last" ] || [ $(( now - last )) -ge 1800 ]; then
    state_set "$key" "$now"
    snapshot_now "$reason"
    FAST_UNTIL=$(( now + FAST_DURATION ))   # 细采样 2s × 10min
  fi
  emit_event "alert_${reason}" "$level" "$3"
}

evaluate_thresholds() {
  local mem_state disk_state m total avail pct
  mem_state="$(classify_mem_state "$MEM_AVAIL_KB" "$MEM_TOTAL_KB")"
  handle_alert "$mem_state" "mem" "{\"avail_kb\":$MEM_AVAIL_KB,\"total_kb\":$MEM_TOTAL_KB,\"load1\":$LOAD1}"
  while IFS='|' read -r m total avail pct; do
    [ -z "$m" ] && continue
    # 脏输入防御：非数字（如异常 df 输出被路径空格拆碎）直接跳过，不产坏 JSON
    case "$total$avail$pct" in ''|*[!0-9-]*) continue ;; esac
    disk_state="$(classify_disk_state "$avail" "$total")"
    handle_alert "$disk_state" "disk" "{\"mount\":\"$(json_escape "$m")\",\"avail_kb\":$avail,\"total_kb\":$total,\"used_pct\":$pct}" "$m"
  done < <(get_disks)
  # 负载：load1 ≥ 2×核数 连续 3 轮
  local lcount strikes
  if awk -v l="$LOAD1" -v n="$NPROC" 'BEGIN{exit !(l >= 2*n)}'; then
    strikes="$(state_get load_strikes)"; strikes=${strikes:-0}
    case "$strikes" in *[!0-9]*) strikes=0 ;; esac
    lcount=$(( strikes + 1 ))
    state_set load_strikes "$lcount"
    [ "$lcount" -ge 3 ] && handle_alert warn "load" "{\"load1\":$LOAD1,\"nproc\":$NPROC,\"strikes\":$lcount}"
  else
    state_set load_strikes 0
  fi
}

startup_checks() {
  ensure_day_files "$(date +%Y%m%d)"
  read_meminfo
  local a c disks_json docker_root docker_avail
  read -r a c <<< "$(compute_mem_thresholds "$MEM_TOTAL_KB")"
  disks_json="$(collect_disks_json)"
  docker_root="$(docker info -f '{{.DockerRootDir}}' 2>/dev/null)"
  docker_avail="null"
  if [ -n "$docker_root" ]; then
    docker_avail="$(df -P -k "$docker_root" 2>/dev/null | awk 'NR==2{print $4}')"
    case "$docker_avail" in ''|*[!0-9]*) docker_avail="null" ;; esac
  fi
  # capacity 基准：事后还原"当时的阈值是怎么算的"（含磁盘与 Docker 数据根分区）
  emit_event capacity info "{\"cores\":$NPROC,\"mem_total_kb\":$MEM_TOTAL_KB,\"mem_warn_kb\":$a,\"mem_crit_kb\":$c,\"disks\":[$disks_json],\"docker_root\":\"$(json_escape "$docker_root")\",\"docker_root_avail_kb\":$docker_avail,\"boot_id\":\"$(boot_id)\"}"
  boot_check
}

boot_check() { # 上一次 boot 的 OOM 与干净关机检测（尽力而为）
  local prev_oom clean
  journalctl --list-boots --no-pager 2>/dev/null | grep -q -- '-' || return 0
  # grep -c 零匹配时输出 "0" 且退出码 1：不能接 || echo 0（会叠加出多行值污染 JSON）
  prev_oom=$(journalctl -b -1 --no-pager 2>/dev/null | grep -icE 'oom-kill|out of memory')
  clean=$(journalctl -b -1 -n 50 --no-pager 2>/dev/null | grep -icE 'powering off|reached target (poweroff|shutdown)')
  prev_oom=${prev_oom:-0}; clean=${clean:-0}
  local level="info"; [ "$prev_oom" -gt 0 ] && level="crit"
  emit_event boot_check "$level" "{\"prev_boot_oom_lines\":$prev_oom,\"prev_boot_clean_shutdown_lines\":$clean}"
}

check_oom_journal() { # 内核日志 OOM 增量（--since 上次检查点）
  command -v journalctl >/dev/null 2>&1 || return 0
  local since now count
  since="$(state_get last_oom_check_epoch)"
  now="$(now_epoch)"
  [ -z "$since" ] && { state_set last_oom_check_epoch "$now"; return 0; }
  count=$(journalctl -k --no-pager --since "@$since" 2>/dev/null | grep -icE 'oom-kill|out of memory')
  count=${count:-0}
  state_set last_oom_check_epoch "$now"
  [ "$count" -gt 0 ] && handle_alert crit "kernel_oom" "{\"oom_lines\":$count}"
  return 0
}

maybe_cleanup() { # $1=YYYYMMDD（每天执行一次）
  local today="$1" last
  last="$(state_get last_cleanup_day)"
  [ "$last" = "$today" ] && return 0
  state_set last_cleanup_day "$today"
  # 前天及更早的 jsonl 压缩（mtime >1 天）
  find "$MON_DIR" -maxdepth 1 -name '*.jsonl' -mtime +1 -exec gzip -f {} \; 2>/dev/null
  # 超保留期删除
  find "$MON_DIR" -maxdepth 1 -name 'metrics-*.jsonl.gz' -mtime +"$METRICS_KEEP_DAYS" -delete 2>/dev/null
  find "$MON_DIR" -maxdepth 1 -name 'events-*.jsonl.gz'  -mtime +"$METRICS_KEEP_DAYS" -delete 2>/dev/null
  find "$MON_DIR/snapshots" -maxdepth 1 -mindepth 1 -type d -mtime +"$SNAPSHOT_KEEP_DAYS" \
    -exec rm -rf {} \; 2>/dev/null
}

# ── 主循环 ──
run_round() {
  local day cpu
  day="$(date +%Y%m%d)"
  ensure_day_files "$day"
  read_meminfo; read_loadavg
  cpu_used_pct
  write_metrics_sample "$CPU_PCT" "$(collect_docker_json)"
  evaluate_thresholds
  check_oom_journal
  maybe_cleanup "$day"
}

sleep_interval() {
  local now; now="$(now_epoch)"
  if [ "${FAST_UNTIL:-0}" -gt "$now" ]; then echo "$FAST_INTERVAL"; else echo "$INTERVAL"; fi
}

main() {
  startup_checks
  while :; do
    run_round || emit_event monitor_error warn "{\"msg\":\"round failed\"}"
    if [ "$ONCE" -eq 1 ]; then
      sleep 1; read_meminfo; read_loadavg
      cpu_used_pct
      write_metrics_sample "$CPU_PCT" "$(collect_docker_json)"
      break
    fi
    sleep "$(sleep_interval)"
  done
}
main
