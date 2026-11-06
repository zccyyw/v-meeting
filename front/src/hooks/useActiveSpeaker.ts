import { useEffect, useRef, useState } from "react";
import { getSharedAudioContext } from "@/media/audioContext";

export type ActiveSpeakerSource = {
  peerId: string;
  stream: MediaStream | null;
};

type AnalyserEntry = {
  peerId: string;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
};

const LEVEL_THRESHOLD = 28; // 0-255 频域均值阈值：低于视为静默
const SAMPLE_MS = 200;
/** 绿框熄灭延迟，对齐原先按格子采样的关断去抖 */
const SPEAK_HOLD_MS = 600;
const ACTIVE_WINDOW_MS = 3000;

function sameIds(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of b) if (!a.has(id)) return false;
  return true;
}

/**
 * 全会议一个 AudioContext、一个采样定时器。
 * speakingPeerIds：当前正在说话（松开后保留 SPEAK_HOLD_MS），驱动视频格音量条。
 * activeSpeakers：最近 3 秒有电平的人，供「只显示说话者」过滤。
 * activePeerId：这一拍最响的人。
 * 页面进后台停表，回到前台再开。关闭 enabled 时不建分析节点。
 */
export function useActiveSpeaker(
  sources: ActiveSpeakerSource[],
  enabled: boolean,
  streamsKey: string,
): {
  activePeerId: string | null;
  activeSpeakers: Set<string>;
  speakingPeerIds: Set<string>;
} {
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [speakingPeerIds, setSpeakingPeerIds] = useState<Set<string>>(new Set());
  const lastActiveRef = useRef<Map<string, number>>(new Map());
  const speakUntilRef = useRef<Map<string, number>>(new Map());
  const activeSpeakersRef = useRef<Set<string>>(new Set());
  const speakingRef = useRef<Set<string>>(new Set());
  const analysersRef = useRef<AnalyserEntry[]>([]);

  useEffect(() => {
    if (!enabled) {
      setActivePeerId(null);
      setActiveSpeakers(new Set());
      setSpeakingPeerIds(new Set());
      return;
    }
    const audioCtx = getSharedAudioContext();
    const entries: AnalyserEntry[] = [];
    if (audioCtx) {
      for (const { peerId, stream } of sources) {
        if (!stream || stream.getAudioTracks().length === 0) continue;
        try {
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          entries.push({
            peerId,
            source,
            analyser,
            data: new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)),
          });
        } catch {
          /* 单路失败不影响其他路 */
        }
      }
    }
    analysersRef.current = entries;
    if (entries.length === 0) {
      setActivePeerId(null);
      setSpeakingPeerIds(new Set());
      return;
    }

    const sample = () => {
      const now = Date.now();
      let best: { id: string; level: number } | null = null;
      for (const it of analysersRef.current) {
        it.analyser.getByteFrequencyData(it.data);
        let sum = 0;
        for (let i = 0; i < it.data.length; i++) sum += it.data[i]!;
        const level = sum / it.data.length;
        if (level > LEVEL_THRESHOLD) {
          speakUntilRef.current.set(it.peerId, now + SPEAK_HOLD_MS);
          lastActiveRef.current.set(it.peerId, now);
          if (!best || level > best.level) best = { id: it.peerId, level };
        }
      }

      const speaking = new Set<string>();
      for (const [pid, until] of speakUntilRef.current) {
        if (until >= now) speaking.add(pid);
        else speakUntilRef.current.delete(pid);
      }
      if (!sameIds(speakingRef.current, speaking)) {
        speakingRef.current = speaking;
        setSpeakingPeerIds(speaking);
      }

      const cutoff = now - ACTIVE_WINDOW_MS;
      for (const [pid, ts] of lastActiveRef.current) {
        if (ts < cutoff) lastActiveRef.current.delete(pid);
      }
      const nextSet = new Set(lastActiveRef.current.keys());
      if (!sameIds(activeSpeakersRef.current, nextSet)) {
        activeSpeakersRef.current = nextSet;
        setActiveSpeakers(nextSet);
      }

      setActivePeerId((prev) => {
        const next = best ? best.id : null;
        return next === prev ? prev : next;
      });
    };

    let timer = 0;
    const start = () => {
      if (timer || document.hidden) return;
      timer = window.setInterval(sample, SAMPLE_MS);
    };
    const stop = () => {
      if (!timer) return;
      window.clearInterval(timer);
      timer = 0;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      for (const it of entries) {
        try {
          it.source.disconnect();
        } catch {
          /* ignore */
        }
        try {
          it.analyser.disconnect();
        } catch {
          /* ignore */
        }
      }
      analysersRef.current = [];
      lastActiveRef.current = new Map();
      speakUntilRef.current = new Map();
      activeSpeakersRef.current = new Set();
      speakingRef.current = new Set();
      setActiveSpeakers(new Set());
      setSpeakingPeerIds(new Set());
    };
    // streamsKey 变化（成员进出/开关麦）时重建分析器；sources 引用变化不触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, streamsKey]);

  return { activePeerId, activeSpeakers, speakingPeerIds };
}
