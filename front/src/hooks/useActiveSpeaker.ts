import { useEffect, useRef, useState } from "react";

export type ActiveSpeakerSource = {
  peerId: string;
  stream: MediaStream | null;
};

type AnalyserEntry = {
  peerId: string;
  ctx: AudioContext;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
};

const LEVEL_THRESHOLD = 28; // 0-255 频域均值阈值：低于视为静默
const SAMPLE_MS = 300;

/**
 * 「正在讲话」检测：对各路音频流建立 WebAudio AnalyserNode，本地采样频域均值，
 * 返回当前说话者的 peerId（无人讲话时为 null）。
 * 纯本地判定，不上报服务器（隐私友好，无协议改动）。
 *
 * @param sources 音频源列表（远端各路 + 本地麦克风的 {peerId, stream}）
 * @param enabled 总开关（本地偏好），关闭时不建 AnalyserNode 且返回 null
 * @param streamsKey 源集合的稳定标识（peerId 列表 + 自身开麦状态），变化时重建分析器
 */
export function useActiveSpeaker(
  sources: ActiveSpeakerSource[],
  enabled: boolean,
  streamsKey: string,
): { activePeerId: string | null; activeSpeakers: Set<string> } {
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  // 最近 3s 内有电平活动的成员集合（"仅显示正在说话的人"过滤用）
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const lastActiveRef = useRef<Map<string, number>>(new Map());
  const activeSpeakersRef = useRef<Set<string>>(new Set());
  // 用 ref 持有分析器列表，避免采样闭包依赖 sources 引用导致频繁重建
  const analysersRef = useRef<AnalyserEntry[]>([]);

  useEffect(() => {
    if (!enabled) {
      setActivePeerId(null);
      setActiveSpeakers(new Set());
      return;
    }
    const entries: AnalyserEntry[] = [];
    const AudioCtx: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      for (const { peerId, stream } of sources) {
        if (!stream || stream.getAudioTracks().length === 0) continue;
        try {
          const ctx = new AudioCtx();
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          entries.push({ peerId, ctx, analyser, data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) });
        } catch {
          /* 单路失败不影响其他路 */
        }
      }
    }
    analysersRef.current = entries;
    if (entries.length === 0) {
      setActivePeerId(null);
      return;
    }

    const timer = window.setInterval(() => {
      let best: { id: string; level: number } | null = null;
      for (const it of analysersRef.current) {
        it.analyser.getByteFrequencyData(it.data);
        let sum = 0;
        for (let i = 0; i < it.data.length; i++) sum += it.data[i];
        const level = sum / it.data.length;
        if (level > LEVEL_THRESHOLD && (!best || level > best.level)) best = { id: it.peerId, level };
      }
      if (best) lastActiveRef.current.set(best.id, Date.now());

      const cutoff = Date.now() - 3000;

      for (const [pid, ts] of lastActiveRef.current) {

        if (ts < cutoff) lastActiveRef.current.delete(pid);

      }

      const prevSet = activeSpeakersRef.current;

      const nextSet = new Set(lastActiveRef.current.keys());

      if (prevSet.size !== nextSet.size || [...nextSet].some((id) => !prevSet.has(id))) {

        activeSpeakersRef.current = nextSet;

        setActiveSpeakers(nextSet);

      }

      setActivePeerId((prev) => {

        const next = best ? best.id : null;

        return next === prev ? prev : next;

      });
    }, SAMPLE_MS);

    return () => {
      window.clearInterval(timer);
      for (const it of entries) {
        try {
          void it.ctx.close();
        } catch {
          /* ignore */
        }
      }
      analysersRef.current = [];
      lastActiveRef.current = new Map();
      activeSpeakersRef.current = new Set();
      setActiveSpeakers(new Set());
    };
    // streamsKey 变化（成员进出/开关麦）时重建分析器；sources 引用变化不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, streamsKey]);

  return { activePeerId, activeSpeakers };
}
