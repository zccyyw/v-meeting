import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCodecCapability,
} from "mediasoup/types";

const mediaCodecs: RtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    preferredPayloadType: 111,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    preferredPayloadType: 96,
    parameters: { "x-google-start-bitrate": 1000 },
  },
  {
    // 信创浏览器（火狐 ESR / 部分裁剪版 Chromium）对 VP8 支持有限，
    // 增加 H264（constrained baseline，兼容性最好）作为协商备选。
    // 服务器为 SFU 纯转发，不参与编解码，无授权问题。
    kind: "video",
    mimeType: "video/H264",
    clockRate: 90000,
    preferredPayloadType: 97,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "42e01f",
      "level-asymmetry-allowed": 1,
      "x-google-start-bitrate": 1000,
    },
  },
];

let worker: Worker;

/** worker 死亡回调（由 index.ts 注册：通知客户端 + 交还守护进程重启）。 */
let onDied: ((info: { rooms?: number; clients?: number }) => void) | null = null;

/** 注册 worker died 处理器。 */
export function onWorkerDied(cb: (info: { rooms?: number; clients?: number }) => void): void {
  onDied = cb;
}

/** Lazy-load mediasoup so room unit tests never require the native module. */
async function loadMediasoup() {
  const mediasoup = await import("mediasoup");
  return mediasoup.default ?? mediasoup;
}

export async function getWorker() {
  if (!worker) {
    const mediasoup = await loadMediasoup();
    worker = await mediasoup.createWorker({
      logLevel: "warn",
      // 默认 1000 个端口：每人 2 个 transport（send/recv），
      // 100 个端口仅够约 50 并发参会者，重连期旧 transport 未释放会更快耗尽。
      rtcMinPort: Number(process.env.RTC_MIN_PORT ?? 40000),
      rtcMaxPort: Number(process.env.RTC_MAX_PORT ?? 41000),
    });
    worker.on("died", () => {
      // 不静默 exit：先记录致命现场，再回调上层（关闭所有 WS 连接、
      // 让客户端收到明确断开原因），最后由 index.ts 退出进程交还
      // docker/systemd 守护重启。进程内重建 worker 无法复活已随 worker
      // 死亡的各房间 router（RoomState.router 均持有其引用），故退出重建
      // 是当前最小可靠恢复路径；worker 池 + router 热重建列入后续优化。
      console.error("[mediasoup] worker died — notifying clients and exiting for supervisor restart");
      try {
        onDied?.({});
      } catch (cbErr) {
        console.error("[mediasoup] onDied callback failed", cbErr);
      }
      // 回调未在 1s 内触发退出（异常路径）时兜底退出，避免半死状态继续服务
      setTimeout(() => process.exit(1), 1000).unref();
    });
  }
  return worker;
}

export async function createRouter() {
  const w = await getWorker();
  return w.createRouter({ mediaCodecs });
}

export async function createWebRtcTransport(router: Router) {
  const listenIps = [
    {
      ip: process.env.MEDIASOUP_LISTEN_IP ?? "0.0.0.0",
      // 用 || 兜底：compose 中未设置时环境变量为空字符串，?? 不会触发兜底，
      // 会导致 announcedIp 为空、客户端拿不到可达候选地址（媒体全部不通）。
      announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1",
    },
  ];
  const transport = await router.createWebRtcTransport({
    listenIps,
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  return transport;
}

export type { Router, WebRtcTransport, Producer, Consumer };
