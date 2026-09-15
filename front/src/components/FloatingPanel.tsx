import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// 共享的自增层级：点击/拖动浮窗即置顶，保证多个浮窗可叠放操作。
let topZIndex = 80;

type Props = {
  /** 宽度（px），窄屏会被 CSS 的 max-width 收敛 */
  width?: number;
  /** 停靠时距容器右边缘的像素（值越大越靠左） */
  dockedRight: number;
  /** 停靠时距容器上/下边缘的像素；高度自适应为“容器高 - 2×margin” */
  dockedMargin?: number;
  /** 首次被拖走时回调（供父级让其余浮窗靠右补位） */
  onDetach?: () => void;
  className?: string;
  children: ReactNode;
};

/**
 * 悬浮面板。
 * - 默认按 `dockedRight` 停靠在容器右侧、上下各留 `dockedMargin`（高度自适应）；
 * - 拖动“标题栏”（.side-panel-header）后转为自由定位，不再自动吸附；
 * - 位置被限制在父容器内（父容器需 position: relative）；
 * - 鼠标与触屏（Pointer 事件）均可拖动。
 */
export function FloatingPanel({
  width = 310,
  dockedRight,
  dockedMargin = 20,
  onDetach,
  className,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // pos/size 非空表示用户已拖走（不再自动吸附）
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [z, setZ] = useState(() => ++topZIndex);
  const [dragging, setDragging] = useState(false);
  // 是否已产生实际位移：未超过阈值前不算拖动（避免误点标题栏就脱离自动排布）
  const movedRef = useRef(false);
  const dragStart = useRef<{
    x: number;
    y: number;
    px: number;
    py: number;
  } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // 任意点击都置顶该浮窗
    setZ(++topZIndex);

    const target = e.target as HTMLElement;
    // 仅从标题栏发起拖动，且不干扰标题栏内的按钮等交互
    if (!target.closest(".side-panel-header")) return;
    if (target.closest("button, a, input, textarea, select")) return;

    const el = ref.current;
    if (!el) return;
    movedRef.current = false;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      px: el.offsetLeft,
      py: el.offsetTop,
    };
    setDragging(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const start = dragStart.current;
      const el = ref.current;
      if (!start || !el) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!movedRef.current && Math.hypot(dx, dy) < 4) return;
      if (!movedRef.current) {
        movedRef.current = true;
        // 首次产生实际位移才脱离自动排布（其余浮窗可补位）
        onDetach?.();
        setSize({ w: el.offsetWidth, h: el.offsetHeight });
      }
      const parent = el.offsetParent as HTMLElement | null;
      const maxX = (parent ? parent.clientWidth : window.innerWidth) - el.offsetWidth;
      const maxY = (parent ? parent.clientHeight : window.innerHeight) - el.offsetHeight;
      setPos({
        x: Math.min(Math.max(0, start.px + dx), Math.max(0, maxX)),
        y: Math.min(Math.max(0, start.py + dy), Math.max(0, maxY)),
      });
    };
    const onUp = () => {
      dragStart.current = null;
      movedRef.current = false;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, onDetach]);

  const style: React.CSSProperties =
    pos && size
      ? {
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
          right: "auto",
          bottom: "auto",
          zIndex: z,
        }
      : {
          right: dockedRight,
          top: dockedMargin,
          bottom: dockedMargin,
          width,
          zIndex: z,
        };

  return (
    <div
      ref={ref}
      className={`floating-panel${dragging ? " floating-panel--dragging" : ""}${
        className ? ` ${className}` : ""
      }`}
      style={style}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  );
}
