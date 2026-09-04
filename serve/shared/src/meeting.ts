import { z } from "zod";

export const UserRoleSchema = z.enum(["host", "participant", "guest"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const MeetingStatusSchema = z.enum([
  "scheduled",
  "waiting",
  "live",
  "ended",
]);
export type MeetingStatus = z.infer<typeof MeetingStatusSchema>;

export const CreateMeetingSchema = z
  .object({
    title: z.string().min(1).max(120),
    scheduledAt: z.string().datetime().optional(),
    waitingRoomEnabled: z.boolean().default(false),
    /** Only applied when scheduledAt is set. */
    joinPassword: z.string().min(4).max(32).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.joinPassword != null && data.joinPassword.length > 0 && !data.scheduledAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "join_password_only_for_scheduled",
        path: ["joinPassword"],
      });
    }
    if (data.scheduledAt) {
      const at = new Date(data.scheduledAt).getTime();
      // Allow ~1 minute clock skew.
      if (!Number.isFinite(at) || at < Date.now() - 60_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scheduled_time_in_past",
          path: ["scheduledAt"],
        });
      }
    }
  });
export type CreateMeetingInput = z.infer<typeof CreateMeetingSchema>;

export const JoinTokenBodySchema = z.object({
  password: z.string().min(1).max(32).optional(),
});
export type JoinTokenBody = z.infer<typeof JoinTokenBodySchema>;

export const MeetingDtoSchema = z.object({
  id: z.union([z.string(), z.number()]),
  code: z.string(),
  title: z.string(),
  hostUserId: z.union([z.string(), z.number()]).nullable(),
  status: MeetingStatusSchema,
  waitingRoomEnabled: z.boolean(),
  scheduledAt: z.string().nullable(),
  createdAt: z.string(),
  passwordRequired: z.boolean().optional(),
});
export type MeetingDto = z.infer<typeof MeetingDtoSchema>;
