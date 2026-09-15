#!/bin/sh
# =============================================================================
# DEB prerm —— Debian / Ubuntu / 统信 UOS 上 dpkg 卸载前调用
#
# 为什么不能复用 RPM 的 %preun（deploy/rpm/preun.sh）：
#   RPM 的 %preun 按"第一个参数是否为 0"判断是否最终卸载（0 = 卸载，1 = 升级），
#   而 Debian 的 prerm 第一个参数是**动作名**：remove / upgrade / deconfigure /
#   failed-upgrade …。直接复用会把 "remove" 当数字比较：
#     dash: [: Illegal number: remove（或 bash: integer expression expected）
#   该行返回非 0 → 整段被跳过 → **卸载时服务不停、仍保持 enable**，
#   且 dpkg 可能因此把卸载标记为失败。
#
# 语义对齐（与 RPM 路径保持一致的最终效果）：
#   remove       → 最终卸载（对应 RPM $1=0）：停服务 + disable
#   upgrade      → 包升级（对应 RPM $1=1）：什么都不做，服务保持运行；
#                  升级后由 postinst 负责重启已运行的服务
#   deconfigure  → 依赖变化导致的解除配置：不动服务
#   其它/缺参    → 不动服务（保守处理，绝不让 dpkg 因本脚本失败）
# =============================================================================
set -e

ACTION="${1:-}"

stop_services() {
    # --no-block 避免卸载流程被服务优雅停止拖住；无 systemd 环境忽略失败
    systemctl --no-block stop meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
    systemctl disable meeting-api meeting-realtime meeting-gateway 2>/dev/null || true
}

case "$ACTION" in
    remove)
        stop_services
        ;;
    *)
        # upgrade / deconfigure / failed-upgrade 等：保持服务现状
        :
        ;;
esac

exit 0
