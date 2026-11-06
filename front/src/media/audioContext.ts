let ctx: AudioContext | null = null;
let gestureBound = false;

/** 全会议共用一个 AudioContext。离开页面不主动 close，避免拆掉仍在用的分析节点。 */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
    return null;
  }
  const resume = () => {
    if (ctx && ctx.state === "suspended") {
      void ctx.resume().catch(() => {
        /* 需要用户激活 */
      });
    }
  };
  if (!gestureBound) {
    gestureBound = true;
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
  }
  void ctx.resume().catch(() => {
    /* 手势监听兜底 */
  });
  return ctx;
}
