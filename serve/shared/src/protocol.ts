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
    peers: z.array(
      z.object({
        peerId: z.string(),
        displayName: z.string(),
        role: UserRoleSchema,
        handRaised: z.boolean(),
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
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
