import { useEffect, useRef, useCallback, useState } from "react";

/**
 * 空闲超时 Hook — 基于 mousemove/keydown/scroll 事件重置计时器。
 * 到 warningSec 弹窗提示，到 timeoutSec 调用 onTimeout 退出。
 *
 * 配置从 sys_config 读取:
 *   sys.session.idleTimeout  空闲超时秒数（默认 600）
 *   sys.session.idleWarning   超时前提醒秒数（默认 60）
 */
export function useIdleTimer(options: {
  timeoutSec: number;
  warningSec: number;
  onTimeout: () => void;
  onWarning?: () => void;
  enabled?: boolean;
}) {
  const { timeoutSec, warningSec, onTimeout, onWarning, enabled = true } = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSec, setRemainingSec] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = useCallback(() => {
    // 清除已有计时器
    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setShowWarning(false);

    if (!enabled) return;

    // 设置警告计时器（timeoutSec - warningSec 秒后触发）
    const warningDelay = (timeoutSec - warningSec) * 1000;
    warningTimerRef.current = setTimeout(() => {
      setShowWarning(true);
      setRemainingSec(warningSec);

      // 倒计时
      countdownRef.current = setInterval(() => {
        setRemainingSec((prev) => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      onWarning?.();
    }, Math.max(warningDelay, 0));

    // 设置超时计时器
    timerRef.current = setTimeout(() => {
      onTimeout();
    }, timeoutSec * 1000);
  }, [timeoutSec, warningSec, onTimeout, onWarning, enabled]);

  useEffect(() => {
    if (!enabled) return;

    // 监听用户活动事件
    const events: (keyof WindowEventMap)[] = ["mousemove", "keydown", "scroll", "click", "touchstart"];

    // 节流：最多每 10 秒重置一次
    let lastReset = Date.now();
    const onActivity = () => {
      const now = Date.now();
      if (now - lastReset > 10_000) {
        lastReset = now;
        reset();
      }
    };

    events.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    // 初始启动
    reset();

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, onActivity));
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, timeoutSec, warningSec]);

  return { showWarning, remainingSec, reset };
}
