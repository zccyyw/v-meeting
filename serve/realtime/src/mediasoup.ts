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
      console.error("mediasoup worker died");
      process.exit(1);
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
      announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP ?? "127.0.0.1",
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
