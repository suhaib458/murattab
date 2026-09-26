import type { AppSnapshot } from "@/repositories/schedule-repository";
import type { AcademicCalendar, ClassSession, Course, DayCode } from "@/domain/models";
import type { PushReminder, PushSubscriptionPayload } from "@/domain/push";
import { ttuAcademicCalendar } from "@/domain/calendar";
import { formatArabicDuration, formatArabicTime } from "@/domain/schedule";
import { getPreferredAcademicCalendar } from "@/features/calendar/academic-calendar-source";

const DEVICE_KEY = "murattab-push-device-v1";
const SYNC_KEY = "murattab-push-sync-v1";
const REFRESH_KEY = "murattab-push-registration-refresh-v1";
const PREFERENCES_KEY = "murattab-notification-preferences-v2";
const REGISTRATION_REFRESH_MS = 60 * 60_000;
const TIME_ZONE = "Asia/Amman";
const SMART_REMINDER_HORIZON_DAYS = 35;
const MAX_SYNCED_REMINDERS = 400;

type DeviceCredentials = { deviceId: string; deviceToken: string };
type ScheduledSession = { session: ClassSession; course: Course };

export type PushStatus = "loading" | "unsupported" | "disabled" | "denied" | "enabled" | "unavailable";
export type BroadcastPushResult = { ok: true; broadcastId: string; queued: number };

export type NotificationPreferences = {
  classReminders: boolean;
  morningBriefing: boolean;
  tomorrowSummary: boolean;
  academicCalendar: boolean;
  dayComplete: boolean;
};

/**
 * Existing users keep the behaviour they explicitly enabled before this
 * feature shipped: per-course reminders only. New opt-ins receive the
 * recommended smart set through enablePushNotifications().
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  classReminders: true,
  morningBriefing: false,
  tomorrowSummary: false,
  academicCalendar: false,
  dayComplete: false
};

export const RECOMMENDED_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  classReminders: true,
  morningBriefing: false,
  tomorrowSummary: true,
  academicCalendar: true,
  dayComplete: false
};

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

function hasStoredNotificationPreferences(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(PREFERENCES_KEY) !== null;
  } catch {
    return false;
  }
}

export function getNotificationPreferences(): NotificationPreferences {
  if (typeof localStorage === "undefined") return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  try {
    const raw = localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES };
    const value = JSON.parse(raw) as Partial<NotificationPreferences>;
    return {
      classReminders: typeof value.classReminders === "boolean" ? value.classReminders : DEFAULT_NOTIFICATION_PREFERENCES.classReminders,
      morningBriefing: typeof value.morningBriefing === "boolean" ? value.morningBriefing : DEFAULT_NOTIFICATION_PREFERENCES.morningBriefing,
      tomorrowSummary: typeof value.tomorrowSummary === "boolean" ? value.tomorrowSummary : DEFAULT_NOTIFICATION_PREFERENCES.tomorrowSummary,
      academicCalendar: typeof value.academicCalendar === "boolean" ? value.academicCalendar : DEFAULT_NOTIFICATION_PREFERENCES.academicCalendar,
      dayComplete: typeof value.dayComplete === "boolean" ? value.dayComplete : DEFAULT_NOTIFICATION_PREFERENCES.dayComplete
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export function saveNotificationPreferences(preferences: NotificationPreferences): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Push can keep working with the conservative defaults in restricted storage environments.
  }
}

export async function updateNotificationPreferences(
  snapshot: AppSnapshot,
  preferences: NotificationPreferences
): Promise<void> {
  saveNotificationPreferences(preferences);
  if (typeof localStorage !== "undefined") localStorage.removeItem(SYNC_KEY);
  await syncPushReminders(snapshot, { force: true, preferences });
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
  if (permission !== "granted") {
    throw new Error(
      Notification.permission === "denied"
        ? "الإشعارات محظورة على هذا الجهاز. اسمح بها من إعدادات النظام ثم جرّب من جديد."
        : "لم يتم منح إذن الإشعارات."
    );
  }

  if (!hasStoredNotificationPreferences()) {
    saveNotificationPreferences(RECOMMENDED_NOTIFICATION_PREFERENCES);
  }

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

function localIsoDate(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(isoDate: string, amount: number): string {
  const cursor = new Date(`${isoDate}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + amount);
  return cursor.toISOString().slice(0, 10);
}

function minIsoDate(a: string, b: string): string {
  return a <= b ? a : b;
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

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(value: number): string {
  const safe = Math.max(0, Math.min(23 * 60 + 59, value));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function shouldKeepReminder(dueAt: Date, now: Date): boolean {
  return dueAt.getTime() > now.getTime() - 10 * 60_000;
}

function sessionsForDate(
  date: string,
  snapshot: AppSnapshot,
  courses: Map<string, Course>
): ScheduledSession[] {
  const dayCode = jsDayToCode[new Date(`${date}T12:00:00Z`).getUTCDay()];
  if (!dayCode) return [];

  return snapshot.sessions
    .filter((session) => session.day === dayCode)
    .map((session) => {
      const course = courses.get(session.courseId);
      return course ? { session, course } : null;
    })
    .filter((item): item is ScheduledSession => item !== null)
    .sort((a, b) => a.session.startsAt.localeCompare(b.session.startsAt));
}

function classCountText(count: number): string {
  if (count === 1) return "محاضرة واحدة";
  if (count === 2) return "محاضرتان";
  if (count >= 3 && count <= 10) return `${count} محاضرات`;
  return `${count} محاضرة`;
}

function buildClassReminders(
  snapshot: AppSnapshot,
  activeTermId: string,
  courses: Map<string, Course>,
  now: Date
): PushReminder[] {
  const activeTerm = snapshot.terms.find((term) => term.id === activeTermId);
  if (!activeTerm) return [];

  const reminders: PushReminder[] = [];
  for (const date of dateRange(activeTerm.startsOn, activeTerm.endsOn)) {
    for (const { session, course } of sessionsForDate(date, snapshot, courses)) {
      if (!course.reminder.enabled) continue;
      const startsAt = zonedDateTimeToUtc(date, session.startsAt, TIME_ZONE);
      const dueAt = new Date(startsAt.getTime() - course.reminder.minutesBefore * 60_000);
      if (!shouldKeepReminder(dueAt, now)) continue;
      const isStartingNow = course.reminder.minutesBefore === 0;
      reminders.push({
        id: `${session.id}:${date}`,
        dueAt: dueAt.toISOString(),
        title: isStartingNow ? "موعد محاضرتك الآن" : "محاضرتك قربت",
        body: isStartingNow
          ? `${course.name} تبدأ الآن · ${session.room.label}`
          : `${course.name} تبدأ بعد ${formatArabicDuration(course.reminder.minutesBefore)} · ${session.room.label}`,
        url: "/schedule"
      });
    }
  }
  return reminders;
}

function buildMorningBriefings(
  snapshot: AppSnapshot,
  activeTermId: string,
  courses: Map<string, Course>,
  start: string,
  end: string,
  now: Date,
  classRemindersEnabled: boolean
): PushReminder[] {
  const reminders: PushReminder[] = [];

  for (const date of dateRange(start, end)) {
    const day = sessionsForDate(date, snapshot, courses);
    if (day.length === 0) continue;

    const first = day[0];
    const briefingMinutes = Math.max(7 * 60, Math.min(9 * 60, timeToMinutes(first.session.startsAt) - 90));
    const dueAt = zonedDateTimeToUtc(date, minutesToTime(briefingMinutes), TIME_ZONE);
    if (!shouldKeepReminder(dueAt, now)) continue;

    if (classRemindersEnabled && first.course.reminder.enabled) {
      const firstStartsAt = zonedDateTimeToUtc(date, first.session.startsAt, TIME_ZONE);
      const classDueAt = new Date(firstStartsAt.getTime() - first.course.reminder.minutesBefore * 60_000);
      if (Math.abs(classDueAt.getTime() - dueAt.getTime()) <= 30 * 60_000) continue;
    }

    reminders.push({
      id: `smart:morning:${date}`,
      dueAt: dueAt.toISOString(),
      title: "صباح الخير، هذا دوامك اليوم",
      body: `${classCountText(day.length)} · أولها ${first.course.name} الساعة ${formatArabicTime(first.session.startsAt)}`,
      url: "/"
    });
  }

  return reminders;
}

function buildTomorrowSummaries(
  snapshot: AppSnapshot,
  courses: Map<string, Course>,
  start: string,
  end: string,
  now: Date
): PushReminder[] {
  const reminders: PushReminder[] = [];

  for (const targetDate of dateRange(start, end)) {
    const dayCode = jsDayToCode[new Date(`${targetDate}T12:00:00Z`).getUTCDay()];
    if (!dayCode) continue;

    const previousDate = addDays(targetDate, -1);
    const dueAt = zonedDateTimeToUtc(previousDate, "19:00", TIME_ZONE);
    if (!shouldKeepReminder(dueAt, now)) continue;

    const day = sessionsForDate(targetDate, snapshot, courses);
    if (day.length === 0) {
      // Avoid a daily stream of "no classes tomorrow" messages. We only send
      // this reassurance after a day that actually had classes.
      const previousDay = sessionsForDate(previousDate, snapshot, courses);
      if (previousDay.length === 0) continue;

      reminders.push({
        id: `smart:tomorrow:${targetDate}`,
        dueAt: dueAt.toISOString(),
        title: "بكرا ما عندك محاضرات",
        body: "حسب جدولك الحالي، يومك فاضي من المحاضرات.",
        url: "/schedule"
      });
      continue;
    }

    const first = day[0];
    reminders.push({
      id: `smart:tomorrow:${targetDate}`,
      dueAt: dueAt.toISOString(),
      title: "ملخص دوام بكرا",
      body: `${classCountText(day.length)} · أولها ${first.course.name} الساعة ${formatArabicTime(first.session.startsAt)} · ${first.session.room.label}`,
      url: "/schedule"
    });
  }

  return reminders;
}

function calendarReminderTitle(kind: AcademicCalendar["events"][number]["kind"]): string {
  if (kind === "exam") return "تنبيه امتحانات الجامعة";
  if (kind === "registration") return "موعد أكاديمي مهم";
  if (kind === "holiday") return "تذكير بالعطلة";
  return "تحديث من التقويم الجامعي";
}

function buildAcademicCalendarReminders(start: string, end: string, now: Date): PushReminder[] {
  const grouped = new Map<string, typeof ttuAcademicCalendar.events>();
  for (const event of ttuAcademicCalendar.events) {
    if (event.startsOn < start || event.startsOn > end) continue;
    grouped.set(event.startsOn, [...(grouped.get(event.startsOn) ?? []), event]);
  }

  const reminders: PushReminder[] = [];
  for (const [date, events] of grouped) {
    const dueAt = zonedDateTimeToUtc(addDays(date, -1), "18:00", TIME_ZONE);
    if (!shouldKeepReminder(dueAt, now)) continue;

    const title = events.length === 1
      ? calendarReminderTitle(events[0].kind)
      : "مواعيد جامعية مهمة غدًا";

    const joinedTitles = events.map((event) => event.title).join(" • ");
    const body = events.length === 1
      ? `غدًا: ${events[0].title}`
      : joinedTitles.length <= 230
        ? joinedTitles
        : `${joinedTitles.slice(0, 227)}…`;

    reminders.push({
      id: `smart:calendar:${date}`,
      dueAt: dueAt.toISOString(),
      title,
      body,
      url: "/calendar"
    });
  }

  return reminders;
}

function buildDayCompleteReminders(
  snapshot: AppSnapshot,
  courses: Map<string, Course>,
  start: string,
  end: string,
  now: Date,
  tomorrowSummaryEnabled: boolean
): PushReminder[] {
  const reminders: PushReminder[] = [];

  for (const date of dateRange(start, end)) {
    const day = sessionsForDate(date, snapshot, courses);
    if (day.length === 0) continue;

    const last = day[day.length - 1];
    const dueAt = new Date(zonedDateTimeToUtc(date, last.session.endsAt, TIME_ZONE).getTime() + 10 * 60_000);
    if (!shouldKeepReminder(dueAt, now)) continue;

    if (tomorrowSummaryEnabled) {
      const tomorrowSummaryAt = zonedDateTimeToUtc(date, "19:00", TIME_ZONE);
      if (Math.abs(tomorrowSummaryAt.getTime() - dueAt.getTime()) <= 45 * 60_000) continue;
    }

    reminders.push({
      id: `smart:complete:${date}`,
      dueAt: dueAt.toISOString(),
      title: "خلص دوامك لليوم",
      body: "يعطيك العافية، هاي كانت آخر محاضرة حسب جدولك اليوم.",
      url: "/"
    });
  }

  return reminders;
}

export function buildPushReminders(
  snapshot: AppSnapshot,
  now = new Date(),
  preferences: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES,
  academicCalendar: AcademicCalendar = ttuAcademicCalendar
): PushReminder[] {
  const activeTerm = snapshot.terms.find((term) => term.id === snapshot.settings.activeTermId) ?? snapshot.terms[0];
  if (!activeTerm) return [];

  const courses = new Map(
    snapshot.courses
      .filter((course) => course.termId === activeTerm.id)
      .map((course) => [course.id, course])
  );

  const reminders: PushReminder[] = [];
  if (preferences.classReminders) {
    reminders.push(...buildClassReminders(snapshot, activeTerm.id, courses, now));
  }

  const today = localIsoDate(now);
  const smartStart = today > activeTerm.startsOn ? today : activeTerm.startsOn;
  const smartEnd = minIsoDate(activeTerm.endsOn, addDays(today, SMART_REMINDER_HORIZON_DAYS));

  if (smartStart <= smartEnd) {
    if (preferences.morningBriefing) {
      reminders.push(...buildMorningBriefings(
        snapshot,
        activeTerm.id,
        courses,
        smartStart,
        smartEnd,
        now,
        preferences.classReminders
      ));
    }
    if (preferences.tomorrowSummary) {
      reminders.push(...buildTomorrowSummaries(snapshot, courses, smartStart, smartEnd, now));
    }
    if (preferences.dayComplete) {
      reminders.push(...buildDayCompleteReminders(
        snapshot,
        courses,
        smartStart,
        smartEnd,
        now,
        preferences.tomorrowSummary
      ));
    }
  }

  if (preferences.academicCalendar) {
    const calendarStart = today;
    const calendarEnd = addDays(today, SMART_REMINDER_HORIZON_DAYS);
    reminders.push(...buildAcademicCalendarReminders(calendarStart, calendarEnd, now, academicCalendar));
  }

  const unique = new Map<string, PushReminder>();
  for (const reminder of reminders.sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
    if (!unique.has(reminder.id)) unique.set(reminder.id, reminder);
  }

  return [...unique.values()]
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .slice(0, MAX_SYNCED_REMINDERS);
}

function reminderSignature(reminders: PushReminder[]): string {
  let hash = 2166136261;
  const value = reminders.map((item) => `${item.id}|${item.dueAt}|${item.title}|${item.body}|${item.url}`).join("\n");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export async function syncPushReminders(
  snapshot: AppSnapshot,
  options: { force?: boolean; preferences?: NotificationPreferences } = {}
): Promise<boolean> {
  if (!supportsPush() || Notification.permission !== "granted") return false;
  const credentials = readCredentials();
  if (!credentials) return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!await registration?.pushManager.getSubscription()) return false;

  const preferences = options.preferences ?? getNotificationPreferences();
  const academicCalendar = preferences.academicCalendar
    ? await getPreferredAcademicCalendar()
    : ttuAcademicCalendar;
  const reminders = buildPushReminders(snapshot, new Date(), preferences, academicCalendar);
  const signature = reminderSignature(reminders);
  if (!options.force && localStorage.getItem(SYNC_KEY) === signature) return false;
  await api("/api/push/reminders", {
    method: "PUT",
    body: JSON.stringify({ ...credentials, reminders })
  });
  localStorage.setItem(SYNC_KEY, signature);
  return true;
}
