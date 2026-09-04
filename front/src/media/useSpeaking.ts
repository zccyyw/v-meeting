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
 */
export function useSpeaking(stream: MediaStream | null | undefined): boolean {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!stream) {
      setSpeaking(false);
      return;
    }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      setSpeaking(false);
      return;
    }

    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let timer = 0;
    let cancelled = false;
    let rawSpeaking = false;
    let lastChangeAt = 0;
    let committed = false;

    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
    } catch {
      return;
    }

    const buf = new Uint8Array(analyser.fftSize);

    const tick = () => {
      if (cancelled || !analyser) return;
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

    timer = window.setInterval(tick, SAMPLE_INTERVAL_MS);

    const onTrackEnded = () => {
      setSpeaking(false);
    };
    for (const t of audioTracks) t.addEventListener("ended", onTrackEnded);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const t of audioTracks)
        t.removeEventListener("ended", onTrackEnded);
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
