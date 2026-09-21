import type { AppSnapshot } from "@/repositories/schedule-repository";
import type { DayCode } from "@/domain/models";
import type { PushReminder, PushSubscriptionPayload } from "@/domain/push";

const DEVICE_KEY = "murattab-push-device-v1";
const SYNC_KEY = "murattab-push-sync-v1";
const REFRESH_KEY = "murattab-push-registration-refresh-v1";
const REGISTRATION_REFRESH_MS = 60 * 60_000;
const TIME_ZONE = "Asia/Amman";

type DeviceCredentials = { deviceId: string; deviceToken: string };
export type PushStatus = "loading" | "unsupported" | "disabled" | "denied" | "enabled" | "unavailable";
export type BroadcastPushResult = { ok: true; broadcastId: string; queued: number };

const jsDayToCode: Partial<Record<number, DayCode>> = {
  0: "ح",
  1: "ن",
  2: "ث",
  3: "ر",
  4: "خ",
  6: "س"
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

function readCredentials(): DeviceCredentials | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "null") as DeviceCredentials | null;
    return parsed?.deviceId && parsed?.deviceToken ? parsed : null;
  } catch {
    return null;
  }
}

function getOrCreateCredentials(): DeviceCredentials {
  const existing = readCredentials();
  if (existing) return existing;
  const token = new Uint8Array(32);
  crypto.getRandomValues(token);
  const credentials = { deviceId: crypto.randomUUID(), deviceToken: bytesToBase64Url(token) };
  localStorage.setItem(DEVICE_KEY, JSON.stringify(credentials));
  return credentials;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers }
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "تعذّر الاتصال بخدمة الإشعارات.");
  return data;
}

function supportsPush(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function ensurePushSubscription(): Promise<PushSubscription> {
  const config = await api<{ available: boolean; publicKey: string | null }>("/api/push/config");
  if (!config.available || !config.publicKey) throw new Error("خدمة الإشعارات غير مجهّزة على الخادم بعد.");

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none"
  });
  await registration.update().catch(() => {});
  const ready = await navigator.serviceWorker.ready;
  const existing = await ready.pushManager.getSubscription();
  return existing ?? ready.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64UrlToUint8Array(config.publicKey)
  });
}

async function registerSubscriptionOnServer(subscription: PushSubscription): Promise<void> {
  const credentials = getOrCreateCredentials();
  await api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ ...credentials, subscription: serializeSubscription(subscription) })
  });
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!supportsPush()) return "unsupported";
  const config = await api<{ available: boolean }>("/api/push/config").catch(() => ({ available: false }));
  if (!config.available) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && readCredentials() ? "enabled" : "disabled";
}

function serializeSubscription(subscription: PushSubscription): PushSubscriptionPayload {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("تعذّر قراءة اشتراك الإشعارات من هذا المتصفح.");
  }
  return {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }
  };
}

export async function enablePushNotifications(snapshot: AppSnapshot): Promise<void> {
  if (!supportsPush()) throw new Error("هذا المتصفح لا يدعم إشعارات الجهاز.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("لازم تسمح بالإشعارات من إعدادات المتصفح أولًا.");

  const subscription = await ensurePushSubscription();
  await registerSubscriptionOnServer(subscription);
  localStorage.setItem(REFRESH_KEY, String(Date.now()));
  await syncPushReminders(snapshot, { force: true });
}

export async function refreshPushRegistration(
  snapshot: AppSnapshot,
  options: { force?: boolean } = {}
): Promise<boolean> {
  if (!supportsPush() || Notification.permission !== "granted") return false;

  const now = Date.now();
  const lastRefresh = Number(localStorage.getItem(REFRESH_KEY) ?? "0");
  if (!options.force && Number.isFinite(lastRefresh) && now - lastRefresh < REGISTRATION_REFRESH_MS) {
    return false;
  }

  const subscription = await ensurePushSubscription();
  await registerSubscriptionOnServer(subscription);
  localStorage.setItem(REFRESH_KEY, String(now));
  await syncPushReminders(snapshot, { force: true });
  return true;
}

export async function disablePushNotifications(): Promise<void> {
  if (!supportsPush()) return;
  const credentials = readCredentials();
  let serverError: unknown;
  if (credentials) {
    try {
      await api("/api/push/device", { method: "DELETE", body: JSON.stringify(credentials) });
    } catch (error) {
      serverError = error;
    }
  }
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  localStorage.removeItem(DEVICE_KEY);
  localStorage.removeItem(SYNC_KEY);
  localStorage.removeItem(REFRESH_KEY);
  if (serverError) throw serverError;
}

export async function sendTestPushNotification(): Promise<void> {
  const credentials = readCredentials();
  if (!credentials) throw new Error("فعّل الإشعارات على هذا الجهاز أولًا.");
  await api("/api/push/test", { method: "POST", body: JSON.stringify(credentials) });
}

export async function getPushAdminStatus(): Promise<boolean> {
  const credentials = readCredentials();
  if (!credentials) return false;
  const result = await api<{ admin: boolean }>("/api/push/admin/status", {
    method: "POST",
    body: JSON.stringify(credentials)
  }).catch(() => ({ admin: false }));
  return result.admin;
}

export async function sendBroadcastPushNotification(input: {
  title: string;
  body: string;
  url?: string;
}): Promise<BroadcastPushResult> {
  const credentials = readCredentials();
  if (!credentials) throw new Error("فعّل الإشعارات على جهاز الإدارة أولًا.");
  return api<BroadcastPushResult>("/api/push/admin/broadcast", {
    method: "POST",
    body: JSON.stringify({
      ...credentials,
      title: input.title,
      body: input.body,
      url: input.url ?? "/"
    })
  });
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(guess)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
    );
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    guess = target - (represented - guess);
  }
  return new Date(guess);
}

function dateRange(start: string, end: string): string[] {
  const output: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    output.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return output;
}

export function buildPushReminders(snapshot: AppSnapshot, now = new Date()): PushReminder[] {
  const activeTerm = snapshot.terms.find((term) => term.id === snapshot.settings.activeTermId) ?? snapshot.terms[0];
  if (!activeTerm) return [];
  const courses = new Map(snapshot.courses.filter((course) => course.termId === activeTerm.id).map((course) => [course.id, course]));
  const reminders: PushReminder[] = [];

  for (const date of dateRange(activeTerm.startsOn, activeTerm.endsOn)) {
    const dayCode = jsDayToCode[new Date(`${date}T12:00:00Z`).getUTCDay()];
    if (!dayCode) continue;
    for (const session of snapshot.sessions) {
      if (session.day !== dayCode) continue;
      const course = courses.get(session.courseId);
      if (!course?.reminder.enabled) continue;
      const startsAt = zonedDateTimeToUtc(date, session.startsAt, TIME_ZONE);
      const dueAt = new Date(startsAt.getTime() - course.reminder.minutesBefore * 60_000);
      if (dueAt.getTime() <= now.getTime() - 10 * 60_000) continue;
      const timing = course.reminder.minutesBefore === 0
        ? "بدأ موعدها الآن"
        : `تبدأ بعد ${course.reminder.minutesBefore} دقيقة`;
      reminders.push({
        id: `${session.id}:${date}`,
        dueAt: dueAt.toISOString(),
        title: `محاضرة ${course.name}`,
        body: `${timing} · ${session.room.label}`,
        url: "/schedule"
      });
    }
  }
  return reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, 400);
}

function reminderSignature(reminders: PushReminder[]): string {
  let hash = 2166136261;
  const value = reminders.map((item) => `${item.id}|${item.dueAt}|${item.title}|${item.body}`).join("\n");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export async function syncPushReminders(snapshot: AppSnapshot, options: { force?: boolean } = {}): Promise<boolean> {
  if (!supportsPush() || Notification.permission !== "granted") return false;
  const credentials = readCredentials();
  if (!credentials) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!await registration?.pushManager.getSubscription()) return false;

  const reminders = buildPushReminders(snapshot);
  const signature = reminderSignature(reminders);
  if (!options.force && localStorage.getItem(SYNC_KEY) === signature) return false;
  await api("/api/push/reminders", {
    method: "PUT",
    body: JSON.stringify({ ...credentials, reminders })
  });
  localStorage.setItem(SYNC_KEY, signature);
  return true;
}
