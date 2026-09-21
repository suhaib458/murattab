import webpush from "web-push";

export interface StoredPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

function asHttpsSubject(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (raw.startsWith("https://") || raw.startsWith("http://") || raw.startsWith("mailto:")) return raw;
  return `https://${raw}`;
}

function getVapidConfig() {
  const subject =
    asHttpsSubject(process.env.VAPID_SUBJECT) ??
    asHttpsSubject(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    asHttpsSubject(process.env.VERCEL_URL) ??
    "https://murattab-pi.vercel.app";
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) {
    throw new Error("VAPID configuration is incomplete");
  }
  return { subject, publicKey, privateKey };
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

export async function sendDevicePush(
  subscription: StoredPushSubscription,
  payload: { title: string; body: string; url: string; tag: string }
): Promise<void> {
  const vapid = getVapidConfig();
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth }
    },
    JSON.stringify(payload),
    { TTL: 60 * 60, urgency: "high" }
  );
}

export function pushErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  const status = Number((error as { statusCode: unknown }).statusCode);
  return Number.isFinite(status) ? status : null;
}
