import { useEffect, useState } from "react";

/**
 * 视口是否为“窄屏”。
 * 会议右侧两个浮窗各 310px、间距 8px、距右 20px，并排约需 648px 容器宽；
 * 计上会议区左右内边距，取视口 700px 作为阈值——窄屏下改为互斥只显一个。
 */
export function useIsNarrow(query = "(max-width: 700px)"): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return narrow;
}
