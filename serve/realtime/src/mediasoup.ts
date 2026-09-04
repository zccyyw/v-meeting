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
      rtcMinPort: Number(process.env.RTC_MIN_PORT ?? 40000),
      rtcMaxPort: Number(process.env.RTC_MAX_PORT ?? 40100),
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
