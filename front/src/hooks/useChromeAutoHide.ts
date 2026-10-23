import { useEffect, useRef, useState } from "react";

/**
 * 沉浸式 chrome 自动隐藏（会议页 header/底部操作区）。
 *
 * 启用后：初始显示，5s 无操作自动隐藏；鼠标移动到 TOP（上 80px）或
 * 底部（下 100px）区域立即显示，其他位置移动 3s 后再次隐藏。
 * 隐藏期间组件应配合 pointer-events:none 让位给下层内容。
 */
export function useChromeAutoHide(enabled: boolean): boolean {
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setVisible(true);
      return;
    }
    let lastMove = 0;
    const show = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
      setVisible(true);
    };
    const scheduleHide = (ms: number) => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        hideTimer.current = null;
        setVisible(false);
      }, ms);
    };
    // 进入沉浸态：先展示 5s 再隐藏
    scheduleHide(5000);
    const onMove = (e: MouseEvent) => {
      const now = performance.now();
      if (now - lastMove < 80) return;
      lastMove = now;
      if (e.clientY < 80 || e.clientY > window.innerHeight - 100) show();
      else scheduleHide(3000);
    };
    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [enabled]);

  return visible;
}
