#!/usr/bin/env bash
# 安装/升级监控采集器为 systemd 服务（需 root）
# 用法：sudo bash scripts/monitor/install-monitor.sh [部署目录]（默认当前目录）
# 重复执行幂等（覆盖脚本与单元文件并重启服务）
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKDIR="${1:-$PWD}"
LIB_DIR=/usr/local/lib/meeting
UNIT=/etc/systemd/system/meeting-monitor.service

[ "$(id -u)" = "0" ] || { echo "!! 请以 root 运行" >&2; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "!! 未找到 systemctl" >&2; exit 1; }

mkdir -p "$LIB_DIR" "$WORKDIR/logs/monitor"
install -m 755 "$SRC_DIR/meeting-monitor.sh" "$LIB_DIR/"
install -m 644 "$SRC_DIR/monitor-thresholds.sh" "$LIB_DIR/"

sed "s|@WORKDIR@|$WORKDIR|" \
  "$SRC_DIR/../../deploy/monitor/meeting-monitor.service" > "$UNIT"

systemctl daemon-reload
systemctl enable --now meeting-monitor
# 升级路径：enable --now 对已运行单元不做任何事，显式重启使新脚本/单元生效（失败不阻断）
systemctl try-restart meeting-monitor 2>/dev/null || true
echo "OK: meeting-monitor 已安装并启动；数据目录：$WORKDIR/logs/monitor/"
echo "    查看状态: systemctl status meeting-monitor"
echo "    查看数据: ls $WORKDIR/logs/monitor/"
