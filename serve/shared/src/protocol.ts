import { z } from "zod";
import { UserRoleSchema } from "./meeting.js";

export const JoinMeetingPayloadSchema = z.object({
  meetingId: z.string().min(1),
  displayName: z.string().min(1).max(64),
  role: UserRoleSchema,
});
export type JoinMeetingPayload = z.infer<typeof JoinMeetingPayloadSchema>;

/** Client → Server */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("join"),
    token: z.string().min(1),
    displayName: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal("leave") }),
  /**
   * 应用层心跳：浏览器无法观测 WS 级 ping/pong，只能靠这条消息自检。
   * 服务端立即回 pong；客户端在超时未收到任何消息时主动断开重连。
   */
  z.object({ type: z.literal("ping") }),
  z.object({ type: z.literal("raiseHand"), raised: z.boolean() }),
  z.object({ type: z.literal("chat"), text: z.string().min(1).max(2000) }),
  z.object({ type: z.literal("setLayout"), layout: z.enum(["grid", "speaker", "training"]) }),
  z.object({ type: z.literal("setFocus"), peerId: z.string().nullable() }),
  z.object({
    type: z.literal("host"),
    action: z.enum([
      "admit",
      "deny",
      "muteAll",
      "unmuteAll",
      "kick",
      "setSharePermission",
      "setWaitingRoom",
      "setRecordAllowed",
      "endMeeting",
      "mutePeer",
      "unmutePeer",
    ]),
    targetPeerId: z.string().optional(),
    allowShare: z.boolean().optional(),
    waitingRoomEnabled: z.boolean().optional(),
    recordAllowed: z.boolean().optional(),
  }),
  z.object({ type: z.literal("getRouterRtpCapabilities") }),
  z.object({
    type: z.literal("createWebRtcTransport"),
    direction: z.enum(["send", "recv"]),
  }),
  z.object({
    type: z.literal("connectWebRtcTransport"),
    transportId: z.string(),
    dtlsParameters: z.unknown(),
  }),
  z.object({
    type: z.literal("produce"),
    transportId: z.string(),
    kind: z.enum(["audio", "video"]),
    rtpParameters: z.unknown(),
    appData: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("consume"),
    producerId: z.string(),
    rtpCapabilities: z.unknown(),
  }),
  z.object({
    type: z.literal("resumeConsumer"),
    consumerId: z.string(),
  }),
  z.object({
    type: z.literal("pauseProducer"),
    producerId: z.string(),
    paused: z.boolean(),
  }),
  z.object({
    type: z.literal("closeProducer"),
    producerId: z.string(),
  }),
  z.object({ type: z.literal("recordingStarted") }),
  z.object({ type: z.literal("recordingStopped") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

/** Server → Client */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("joined"),
    peerId: z.string(),
    meetingId: z.string(),
    role: UserRoleSchema,
    inWaitingRoom: z.boolean(),
    waitingRoomEnabled: z.boolean().optional(),
    recordAllowed: z.boolean().optional(),
    // 房间当前布局与焦点：后入会者据此直接落到主持人已切换的布局，
    // 否则前端只会用默认值（宫格）。
    layout: z.enum(["grid", "speaker", "training"]).optional(),
    focusPeerId: z.string().nullable().optional(),
    // 房间当前共享权限：主持人可能在有人入会前就已关闭共享，
    // 不下发会导致后入会者看到可用的共享入口、点击却被服务端拒绝。
    allowShare: z.boolean().optional(),
    peers: z.array(
      z.object({
        peerId: z.string(),
        displayName: z.string(),
        role: UserRoleSchema,
        handRaised: z.boolean(),
        // 媒体/录制状态快照：此前只能靠 newProducer/producerPaused/peerRecording
        // 等增量消息推导，后入会者在增量到达前会把所有人误判为"未开麦、未录制"。
        camEnabled: z.boolean().optional(),
        micEnabled: z.boolean().optional(),
        recording: z.boolean().optional(),
      })
    ),
  }),
  z.object({
    type: z.literal("waiting"),
    peerId: z.string(),
    displayName: z.string(),
  }),
  z.object({
    type: z.literal("peerJoined"),
    peerId: z.string(),
    displayName: z.string(),
    role: UserRoleSchema,
  }),
  z.object({ type: z.literal("peerLeft"), peerId: z.string() }),
  z.object({
    type: z.literal("handRaised"),
    peerId: z.string(),
    raised: z.boolean(),
  }),
  z.object({
    type: z.literal("chat"),
    peerId: z.string(),
    displayName: z.string(),
    text: z.string(),
    at: z.string(),
  }),
  z.object({
    type: z.literal("layout"),
    layout: z.enum(["grid", "speaker", "training"]),
    focusPeerId: z.string().nullable(),
  }),
  z.object({ type: z.literal("forceMute"), audio: z.boolean(), video: z.boolean() }),
  z.object({ type: z.literal("kicked"), reason: z.string() }),
  z.object({ type: z.literal("meetingEnded") }),
  z.object({ type: z.literal("sharePermission"), allowed: z.boolean() }),
  z.object({ type: z.literal("waitingRoomChanged"), enabled: z.boolean() }),
  z.object({ type: z.literal("recordAllowedChanged"), allowed: z.boolean() }),
  z.object({
    type: z.literal("peerRecording"),
    peerId: z.string(),
    displayName: z.string(),
    active: z.boolean(),
  }),
  z.object({ type: z.literal("routerRtpCapabilities"), rtpCapabilities: z.unknown() }),
  z.object({
    type: z.literal("transportCreated"),
    direction: z.enum(["send", "recv"]),
    id: z.string(),
    iceParameters: z.unknown(),
    iceCandidates: z.unknown(),
    dtlsParameters: z.unknown(),
  }),
  z.object({
    type: z.literal("transportConnected"),
    transportId: z.string(),
  }),
  z.object({
    /** 服务端观测到 WebRTC transport ICE/DTLS 异常时通知客户端给出可见提示 */
    type: z.literal("mediaState"),
    state: z.enum(["failed", "disconnected"]),
    transportId: z.string().optional(),
  }),
  z.object({ type: z.literal("produced"), id: z.string(), kind: z.enum(["audio", "video"]) }),
  z.object({
    type: z.literal("newProducer"),
    peerId: z.string(),
    producerId: z.string(),
    kind: z.enum(["audio", "video"]),
    appData: z.record(z.unknown()).optional(),
    paused: z.boolean().optional(),
    source: z.enum(["microphone", "camera", "screen"]).optional(),
  }),
  z.object({
    type: z.literal("producerClosed"),
    producerId: z.string(),
    peerId: z.string(),
    source: z.enum(["microphone", "camera", "screen"]).optional(),
  }),
  z.object({
    type: z.literal("producerPaused"),
    peerId: z.string(),
    producerId: z.string(),
    kind: z.enum(["audio", "video"]),
    paused: z.boolean(),
    source: z.enum(["microphone", "camera", "screen"]).optional(),
  }),
  z.object({
    type: z.literal("consumed"),
    id: z.string(),
    producerId: z.string(),
    kind: z.enum(["audio", "video"]),
    rtpParameters: z.unknown(),
    peerId: z.string(),
    appData: z.record(z.unknown()).optional(),
  }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
