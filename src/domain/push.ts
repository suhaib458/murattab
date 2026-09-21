import { z } from "zod";

export const PushSubscriptionPayloadSchema = z.object({
  endpoint: z.url().max(2048),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512)
  })
});

const LocalAppPathSchema = z
  .string()
  .max(300)
  .regex(/^\/(?!\/)[^\\\r\n]*$/, "Push URL must be a same-origin app path");

const DeviceCredentialsSchema = z.object({
  deviceId: z.uuid(),
  deviceToken: z.string().min(32).max(256)
});

export const PushSubscribeRequestSchema = DeviceCredentialsSchema.extend({
  subscription: PushSubscriptionPayloadSchema
});

export const PushReminderSchema = z.object({
  id: z.string().min(1).max(200),
  dueAt: z.iso.datetime(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(240),
  url: LocalAppPathSchema
});

export const PushSyncRequestSchema = DeviceCredentialsSchema.extend({
  reminders: z.array(PushReminderSchema).max(400)
});

export const PushDeviceRequestSchema = DeviceCredentialsSchema;

export const PushBroadcastRequestSchema = DeviceCredentialsSchema.extend({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(240),
  url: LocalAppPathSchema.default("/")
});

export type PushReminder = z.infer<typeof PushReminderSchema>;
export type PushSubscriptionPayload = z.infer<typeof PushSubscriptionPayloadSchema>;
export type PushBroadcastRequest = z.infer<typeof PushBroadcastRequestSchema>;
