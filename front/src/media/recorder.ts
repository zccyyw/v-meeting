/**
 * 会议录制器：Canvas 合成宫格画面 + 混合音频 + MediaRecorder。
 * 从 MediaRoom snapshot 动态拉取所有视频/音频流，实时绘制到画布。
 */
export type RecorderSource = {
  /** 用于取视频/音频轨道的流；key 仅用于日志/排重 */
  key: string;
  label: string;
  video?: MediaStreamTrack | null;
  audio?: MediaStreamTrack | null;
};

export type RecorderHandle = {
  stop: () => Promise<Blob>;
  /** 当前已录制时长（毫秒） */
  durationMs: () => number;
};

const CANVAS_W = 1280;
const CANVAS_H = 720;
const TILE_GAP = 8;
const BG = "#0b0f14";
const LABEL_BG = "rgba(0,0,0,0.55)";
const LABEL_FG = "#ffffff";

function pickMime(): string {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=h264,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "video/webm";
}

/** 将多个音频轨道混合为一条轨道。 */
function mixAudioTracks(tracks: MediaStreamTrack[]): MediaStreamTrack | null {
  const active = tracks.filter((t) => t && t.readyState === "live");
  if (active.length === 0) return null;
  if (active.length === 1) return active[0]!;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    const dest = ctx.createMediaStreamDestination();
    for (const t of active) {
      try {
        const src = ctx.createMediaStreamSource(new MediaStream([t]));
        src.connect(dest);
      } catch {
        /* ignore single track failure */
      }
    }
    const mixed = dest.stream.getAudioTracks()[0];
    if (mixed) return mixed;
  } catch (err) {
    console.warn("audio mix failed, fallback to first track", err);
  }
  return active[0]!;
}

function gridLayout(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 9) return { cols: 3, rows: 3 };
  return { cols: 4, rows: Math.ceil(count / 4) };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * 启动录制。
 * @param getSources 返回当前所有音视频源的函数（每帧调用以适应动态变化）
 * @returns 录制句柄
 */
export function startRecording(
  getSources: () => RecorderSource[]
): RecorderHandle {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext("2d")!;

  // 用于绘制视频的隐藏 video 元素池（key -> video）
  const videoPool = new Map<string, HTMLVideoElement>();

  function ensureVideo(key: string): HTMLVideoElement {
    let v = videoPool.get(key);
    if (!v) {
      v = document.createElement("video");
      v.muted = true;
      (v as HTMLVideoElement & { playsInline: boolean }).playsInline = true;
      v.autoplay = true;
      videoPool.set(key, v);
    }
    return v;
  }

  function syncVideoElements(sources: RecorderSource[]) {
    const liveKeys = new Set(
      sources.filter((s) => s.video && s.video.readyState === "live").map((s) => s.key)
    );
    for (const [key, v] of videoPool) {
      if (!liveKeys.has(key)) {
        try {
          v.srcObject = null;
        } catch {
          /* ignore */
        }
        videoPool.delete(key);
      }
    }
    for (const s of sources) {
      if (!s.video || s.video.readyState !== "live") continue;
      const v = ensureVideo(s.key);
      const current = v.srcObject as MediaStream | null;
      const hasTrack = current?.getVideoTracks().includes(s.video);
      if (!hasTrack) {
        v.srcObject = new MediaStream([s.video]);
        void v.play().catch(() => {
          /* autoplay may fail until user gesture */
        });
      }
    }
  }

  function drawFrame() {
    const sources = getSources().filter(
      (s) => s.video && s.video.readyState === "live"
    );
    syncVideoElements(sources);

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const tiles = sources.length;
    if (tiles === 0) {
      ctx.fillStyle = "#6b7785";
      ctx.font = "28px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("会议录制中 · 暂无视频画面", CANVAS_W / 2, CANVAS_H / 2);
      return;
    }

    const { cols, rows } = gridLayout(tiles);
    const cellW = (CANVAS_W - TILE_GAP * (cols + 1)) / cols;
    const cellH = (CANVAS_H - TILE_GAP * (rows + 1)) / rows;

    sources.slice(0, cols * rows).forEach((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = TILE_GAP + col * (cellW + TILE_GAP);
      const y = TILE_GAP + row * (cellH + TILE_GAP);

      ctx.save();
      roundedRect(ctx, x, y, cellW, cellH, 10);
      ctx.clip();
      ctx.fillStyle = "#000";
      ctx.fillRect(x, y, cellW, cellH);

      const v = videoPool.get(s.key);
      if (v && v.videoWidth > 0 && v.videoHeight > 0) {
        // object-fit: cover
        const vw = v.videoWidth;
        const vh = v.videoHeight;
        const scale = Math.max(cellW / vw, cellH / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = x + (cellW - dw) / 2;
        const dy = y + (cellH - dh) / 2;
        ctx.drawImage(v, dx, dy, dw, dh);
      } else {
        ctx.fillStyle = "#6b7785";
        ctx.font = "20px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("摄像头未开启", x + cellW / 2, y + cellH / 2);
      }
      ctx.restore();

      // 标签条
      const labelText = s.label || "参会者";
      ctx.font = "16px system-ui, -apple-system, sans-serif";
      const tw = ctx.measureText(labelText).width;
      ctx.fillStyle = LABEL_BG;
      ctx.fillRect(x + 6, y + cellH - 30, tw + 16, 24);
      ctx.fillStyle = LABEL_FG;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(labelText, x + 14, y + cellH - 18);
    });
  }

  const rafId = window.setInterval(drawFrame, 1000 / 15); // 15fps，降低 CPU

  const canvasStream = canvas.captureStream(15);
  const sources0 = getSources();
  const audioTracks = sources0
    .map((s) => s.audio)
    .filter((t): t is MediaStreamTrack => !!t && t.readyState === "live");
  const mixedAudio = mixAudioTracks(audioTracks);
  if (mixedAudio) {
    canvasStream.addTrack(mixedAudio);
  }

  const mime = pickMime();
  const recorder = new MediaRecorder(canvasStream, {
    mimeType: mime,
    videoBitsPerSecond: 1_500_000,
    audioBitsPerSecond: 64_000,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const startedAt = Date.now();
  recorder.start(1000);

  function cleanup() {
    window.clearInterval(rafId);
    try {
      for (const v of videoPool.values()) {
        v.srcObject = null;
      }
    } catch {
      /* ignore */
    }
    videoPool.clear();
    for (const t of canvasStream.getTracks()) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    }
  }

  return {
    durationMs: () => Date.now() - startedAt,
    stop: () =>
      new Promise<Blob>((resolve) => {
        recorder.onstop = () => {
          cleanup();
          resolve(new Blob(chunks, { type: mime }));
        };
        try {
          if (recorder.state !== "inactive") recorder.stop();
          else cleanup();
        } catch {
          cleanup();
          resolve(new Blob(chunks, { type: mime }));
        }
      }),
  };
}
