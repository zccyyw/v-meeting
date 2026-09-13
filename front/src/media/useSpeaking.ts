import { useEffect, useState } from "react";

const SPEAK_THRESHOLD = 0.06;
const SAMPLE_INTERVAL_MS = 100;
const SPEAK_ON_DEBOUNCE_MS = 120;
const SPEAK_OFF_DEBOUNCE_MS = 600;

/**
 * Detects whether a media stream is currently producing audible audio by
 * sampling volume via the Web Audio API. Used to show a speaking indicator on
 * video tiles. Returns false for null streams or when the AudioContext cannot
 * be created.
 *
 * 注意：远端流的音轨可能晚于画面轨到达（consumeProducer 分别消费音频/视频
 * producer，先到者先 addTrack）。因此不能在 effect 开始时因"无音轨"提前
 * 退出——必须在采样循环内惰性检测音轨并按需创建分析器，否则晚到的音轨
 * 永远不会被分析，说话指示将永久失效。
 */
export function useSpeaking(stream: MediaStream | null | undefined): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream) {
      setSpeaking(false);
      return;
    }

    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let buf: Uint8Array<ArrayBuffer> | null = null;
    let timer = 0;
    let cancelled = false;
    let rawSpeaking = false;
    let lastChangeAt = 0;
    let committed = false;
    let cleanupGesture: (() => void) | null = null;
    const trackedTracks = new Set<MediaStreamTrack>();

    const onTrackEnded = () => {
      setSpeaking(false);
    };

    /** 惰性创建分析器：音轨就绪时调用一次，返回是否就绪。 */
    function ensureGraph(): boolean {
      if (cancelled) return false;
      if (analyser) return true;
      if (stream!.getAudioTracks().length === 0) return false;
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctx) return false;
        ctx = new Ctx();
        source = ctx.createMediaStreamSource(stream!);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        buf = new Uint8Array(analyser.fftSize);
        // 自动播放策略：无用户激活时创建的 AudioContext 初始为 suspended，
        // 挂起状态下 AnalyserNode 收不到任何数据（全 128 静音），
        // 说话指示永远不显示。入会点击后可能因权限弹窗消耗掉瞬时激活，
        // 这里立即尝试恢复，并兜底在首次用户手势时再次恢复。
        void ctx.resume().catch(() => {
          /* 需要用户激活，由下方手势监听兜底 */
        });
        const resumeOnGesture = () => {
          if (ctx && ctx.state === "suspended") {
            void ctx.resume().catch(() => {
              /* ignore */
            });
          }
        };
        document.addEventListener("pointerdown", resumeOnGesture, {
          once: true,
        });
        document.addEventListener("keydown", resumeOnGesture, { once: true });
        cleanupGesture = () => {
          document.removeEventListener("pointerdown", resumeOnGesture);
          document.removeEventListener("keydown", resumeOnGesture);
        };
        for (const t of stream!.getAudioTracks()) {
          if (!trackedTracks.has(t)) {
            trackedTracks.add(t);
            t.addEventListener("ended", onTrackEnded);
          }
        }
        return true;
      } catch {
        return false;
      }
    }

    const tick = () => {
      if (cancelled) return;
      if (!ensureGraph() || !analyser || !buf) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i]! - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      const isLoud = rms > SPEAK_THRESHOLD;

      if (isLoud !== rawSpeaking) {
        rawSpeaking = isLoud;
        lastChangeAt = now;
      }

      const debounce = rawSpeaking
        ? SPEAK_ON_DEBOUNCE_MS
        : SPEAK_OFF_DEBOUNCE_MS;
      if (rawSpeaking !== committed && now - lastChangeAt >= debounce) {
        committed = rawSpeaking;
        setSpeaking(committed);
      }
    };

    // 立即尝试一次（本地流通常音轨已就绪），失败则由采样循环继续等待
    ensureGraph();
    timer = window.setInterval(tick, SAMPLE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      cleanupGesture?.();
      for (const t of trackedTracks) t.removeEventListener("ended", onTrackEnded);
      try {
        source?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        analyser?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        void ctx?.close();
      } catch {
        /* ignore */
      }
    };
  }, [stream]);

  return speaking;
}
