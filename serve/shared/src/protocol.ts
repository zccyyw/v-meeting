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
  z.object({
    type: z.literal("ping"),
    /** 发送时刻（客户端时钟）：服务端原样回显，用于测量信令 RTT */
    t: z.number().optional(),
  }),
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
    type: z.literal("restartIce"),
    transportId: z.string(),
  }),
  z.object({
    /** 客户端周期上报自己到服务器的 RTT（ms），服务端汇总后广播全房间 */
    type: z.literal("networkStats"),
    rttMs: z.number().nonnegative(),
  }),
  z.object({
    /** 主持人开关"成员画面轮换"（培训/演讲布局右侧面板） */
    type: z.literal("setRotation"),
    enabled: z.boolean(),
  }),
  z.object({
    /** 主持人控制"成员轮播侧栏"是否对其他参会者可见 */
    type: z.literal("setSideListVisible"),
    visible: z.boolean(),
  }),
  /** 主持人锁定会议：锁定后禁止新成员加入（含等候室请求） */
  z.object({ type: z.literal("setLocked"), locked: z.boolean() }),
  /** 主持人开关"全员隐藏会议号"（主持人详情面板仍可查看） */
  z.object({ type: z.literal("setHideCode"), hide: z.boolean() }),
  /** 主持人开关自由聊天：关闭后成员不能发送聊天消息与弹幕 */
  z.object({ type: z.literal("setChatAllowed"), allowed: z.boolean() }),
  /** 主持人开关"允许成员自我解除静音" */
  z.object({ type: z.literal("setSelfUnmuteAllowed"), allowed: z.boolean() }),
  /** 主持人开关"允许成员举手" */
  z.object({ type: z.literal("setRaiseHandAllowed"), allowed: z.boolean() }),
  /** 主持人开关"允许成员表情回应" */
  z.object({ type: z.literal("setReactionAllowed"), allowed: z.boolean() }),
  /** 成员发表情反应（reactionAllowed 时可用） */
  z.object({
    type: z.literal("setReaction"),
    emoji: z.string().min(1).max(16),
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
    /** 服务端能力标记：客户端据此决定是否发送屏幕共享音频轨（旧服务端缺省 → 降级不发送） */
    capabilities: z
      .object({ screenAudio: z.boolean().optional() })
      .optional(),
    waitingRoomEnabled: z.boolean().optional(),
    recordAllowed: z.boolean().optional(),
    // 房间当前布局与焦点：后入会者据此直接落到主持人已切换的布局，
    // 否则前端只会用默认值（宫格）。
    layout: z.enum(["grid", "speaker", "training"]).optional(),
    focusPeerId: z.string().nullable().optional(),
    // 房间当前共享权限：主持人可能在有人入会前就已关闭共享，
    // 不下发会导致后入会者看到可用的共享入口、点击却被服务端拒绝。
    allowShare: z.boolean().optional(),
    // 主持人控制的"成员画面轮换"开关状态：后入会者直接同步
    rotationEnabled: z.boolean().optional(),
    // 沉浸模式（主画面全屏 + 浮层控件）与投屏显示模式：后入会者直接同步
    // 主持人控制的"成员轮播侧栏对参会者可见"开关：后入会者直接同步
    sideListVisible: z.boolean().optional(),
    // 以下为主持人控制的房间控制项：后入会者直接同步
    locked: z.boolean().optional(),
    hideCode: z.boolean().optional(),
    chatAllowed: z.boolean().optional(),
    selfUnmuteAllowed: z.boolean().optional(),
    raiseHandAllowed: z.boolean().optional(),
    reactionAllowed: z.boolean().optional(),
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
    /** 客户端请求 ICE restart 后返回新的 iceParameters（网络抖动自愈） */
    type: z.literal("iceRestarted"),
    transportId: z.string(),
    iceParameters: z.unknown(),
  }),
  z.object({
    /** 全房间成员的网络延迟表（各自上报的到服务器 RTT），驱动画面角标 */
    type: z.literal("peerNetworkStats"),
    peers: z.array(
      z.object({
        peerId: z.string(),
        rttMs: z.number().nonnegative(),
      }),
    ),
  }),
  z.object({
    /** 主持人切换"成员画面轮换"后广播全员 */
    type: z.literal("rotationChanged"),
    enabled: z.boolean(),
  }),

  z.object({
    /** 主持人切换"成员轮播侧栏可见性"后广播全员 */
    type: z.literal("sideListVisibleChanged"),
    visible: z.boolean(),
  }),
  z.object({ type: z.literal("lockedChanged"), locked: z.boolean() }),
  z.object({ type: z.literal("hideCodeChanged"), hide: z.boolean() }),
  z.object({ type: z.literal("chatAllowedChanged"), allowed: z.boolean() }),
  z.object({ type: z.literal("selfUnmuteAllowedChanged"), allowed: z.boolean() }),
  z.object({ type: z.literal("raiseHandAllowedChanged"), allowed: z.boolean() }),
  z.object({ type: z.literal("reactionAllowedChanged"), allowed: z.boolean() }),
  z.object({
    type: z.literal("reaction"),
    peerId: z.string(),
    emoji: z.string().min(1).max(16),
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
    source: z.enum(["microphone", "camera", "screen", "screen-audio"]).optional(),
  }),
  z.object({
    type: z.literal("producerClosed"),
    producerId: z.string(),
    peerId: z.string(),
    source: z.enum(["microphone", "camera", "screen", "screen-audio"]).optional(),
  }),
  z.object({
    type: z.literal("producerPaused"),
    peerId: z.string(),
    producerId: z.string(),
    kind: z.enum(["audio", "video"]),
    paused: z.boolean(),
    source: z.enum(["microphone", "camera", "screen", "screen-audio"]).optional(),
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
  z.object({
    type: z.literal("pong"),
    /** 回显客户端 ping 的时间戳 */
    t: z.number().optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
