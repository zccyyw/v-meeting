import { useEffect, useRef, useState } from "react";

export type DanmuItem = {
  id: number;
  text: string;
  self: boolean;
};

type Props = {
  items: DanmuItem[];
  onExpired: (id: number) => void;
};

const DANMU_TTL_MS = 24000;
const TRACK_COUNT = 4;
const TICK_MS = 250;

type Slot = {
  id: number;
  text: string;
  self: boolean;
  track: number;
  expiresAt: number;
};

export function DanmuOverlay({ items, onExpired }: Props) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [paused, setPaused] = useState(false);
  const trackFreeAt = useRef<number[]>(new Array(TRACK_COUNT).fill(0));
  const seenIds = useRef<Set<number>>(new Set());
  const pausedRef = useRef(false);
  const pauseStartRef = useRef<number | null>(null);
  const onExpiredRef = useRef(onExpired);
  onExpiredRef.current = onExpired;

  useEffect(() => {
    pausedRef.current = paused;
    if (paused) {
      pauseStartRef.current = Date.now();
    } else if (pauseStartRef.current != null) {
      const delta = Date.now() - pauseStartRef.current;
      pauseStartRef.current = null;
      trackFreeAt.current = trackFreeAt.current.map((t) => t + delta);
      setSlots((prev) =>
        prev.map((s) => ({ ...s, expiresAt: s.expiresAt + delta })),
      );
    }
  }, [paused]);

  useEffect(() => {
    const now = Date.now();
    const fresh: DanmuItem[] = [];
    for (const it of items) {
      if (seenIds.current.has(it.id)) continue;
      seenIds.current.add(it.id);
      fresh.push(it);
    }
    if (fresh.length === 0) return;

    const start = pausedRef.current && pauseStartRef.current != null
      ? pauseStartRef.current
      : now;

    const next: Slot[] = [];
    for (const it of fresh) {
      let track = -1;
      let earliest = Infinity;
      for (let i = 0; i < TRACK_COUNT; i++) {
        const t = trackFreeAt.current[i] ?? 0;
        if (t <= start) {
          track = i;
          break;
        }
        if (t < earliest) {
          earliest = t;
          track = i;
        }
      }
      const startAt = Math.max(start, trackFreeAt.current[track] ?? 0);
      const expiresAt = startAt + DANMU_TTL_MS;
      trackFreeAt.current[track] = expiresAt;
      next.push({ ...it, track, expiresAt });
    }
    setSlots((prev) => [...prev, ...next].slice(-20));
  }, [items]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      if (pausedRef.current) return;
      const now = Date.now();
      setSlots((prev) => {
        const expired = prev.filter((s) => s.expiresAt <= now);
        if (expired.length === 0) return prev;
        for (const s of expired) onExpiredRef.current(s.id);
        return prev.filter((s) => s.expiresAt > now);
      });
    }, TICK_MS);
    return () => window.clearInterval(tick);
  }, []);

  return (
    <div
      className="danmu-overlay"
      aria-hidden
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {slots.map((s) => (
        <span
          key={s.id}
          className={`danmu-item${s.self ? " danmu-item--self" : ""}`}
          style={{ top: `${s.track * 25}%` }}
        >
          {s.text}
        </span>
      ))}
    </div>
  );
}
