import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_PREFERENCES, buildPushReminders, base64UrlToUint8Array } from "@/features/notifications/push-client";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import { PushBroadcastRequestSchema } from "@/domain/push";
import { hashDeviceToken, safeTokenHashMatches } from "@/server/push/supabase-rest";

const termId = "22222222-2222-4222-8222-222222222222";
const courseId = "11111111-1111-4111-8111-111111111111";
const sessionId = "33333333-3333-4333-8333-333333333333";

function snapshot(reminderEnabled = true, minutesBefore = 15): AppSnapshot {
  return {
    profile: null,
    settings: {
      id: "settings",
      theme: "light",
      onboardingComplete: true,
      splashShown: true,
      activeTermId: termId,
      schemaVersion: 1
    },
    terms: [{
      id: termId,
      name: "الفصل التجريبي",
      startsOn: "2026-10-04",
      endsOn: "2026-10-11",
      isCurrent: true
    }],
    courses: [{
      id: courseId,
      termId,
      name: "هندسة البرمجيات",
      reminder: { enabled: reminderEnabled, minutesBefore },
      createdAt: "2026-09-01T00:00:00.000Z"
    }],
    sessions: [{
      id: sessionId,
      courseId,
      day: "ح",
      startsAt: "09:00",
      endsAt: "10:00",
      room: { raw: "م 207", label: "مجمع القاعات – قاعة 207", isOnline: false },
      kind: "lecture"
    }]
  };
}

describe("إشعارات الجهاز", () => {
  it("يبني تذكيرًا أسبوعيًا بتوقيت عمّان ويستبعد البيانات الشخصية", () => {
    const reminders = buildPushReminders(snapshot(), new Date("2026-10-01T00:00:00.000Z"));

    expect(reminders).toHaveLength(2);
    expect(reminders[0]).toEqual({
      id: `${sessionId}:2026-10-04`,
      dueAt: "2026-10-04T05:45:00.000Z",
      title: "محاضرتك قربت",
      body: "هندسة البرمجيات تبدأ بعد 15 دقيقة · مجمع القاعات – قاعة 207",
      url: "/schedule"
    });
    expect(JSON.stringify(reminders)).not.toContain("طالب");
  });

  it("يصيغ مدة التذكير الطويلة بالعربية بدل عرض عدد دقائق كبير", () => {
    const reminders = buildPushReminders(snapshot(true, 60), new Date("2026-10-01T00:00:00.000Z"));
    expect(reminders[0].body).toContain("تبدأ بعد ساعة");
  });

  it("يصيغ إشعار بدء المحاضرة الآن بصيغة واضحة", () => {
    const reminders = buildPushReminders(snapshot(true, 0), new Date("2026-10-01T00:00:00.000Z"));

    expect(reminders[0]).toMatchObject({
      title: "موعد محاضرتك الآن",
      body: "هندسة البرمجيات تبدأ الآن · مجمع القاعات – قاعة 207"
    });
  });

  it("لا ينشئ تذكيرات للمواد التي أوقف المستخدم تنبيهها", () => {
    expect(buildPushReminders(snapshot(false), new Date("2026-10-01T00:00:00.000Z"))).toEqual([]);
  });

  it("يبني ملخص دوام بكرا الساعة 7 مساءً بدون بيانات شخصية", () => {
    const reminders = buildPushReminders(
      snapshot(),
      new Date("2026-10-03T12:00:00.000Z"),
      {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        classReminders: false,
        tomorrowSummary: true
      }
    );

    const reminder = reminders.find((item) => item.id === "smart:tomorrow:2026-10-04");
    expect(reminder).toEqual({
      id: "smart:tomorrow:2026-10-04",
      dueAt: "2026-10-03T16:00:00.000Z",
      title: "ملخص دوام بكرا",
      body: "محاضرة واحدة · أولها هندسة البرمجيات الساعة 9:00 ص · مجمع القاعات – قاعة 207",
      url: "/schedule"
    });
  });

  it("يبني ملخصًا صباحيًا ذكيًا قبل أول محاضرة", () => {
    const reminders = buildPushReminders(
      snapshot(),
      new Date("2026-10-03T12:00:00.000Z"),
      {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        classReminders: false,
        morningBriefing: true
      }
    );

    expect(reminders.find((item) => item.id === "smart:morning:2026-10-04")).toMatchObject({
      dueAt: "2026-10-04T04:30:00.000Z",
      title: "صباح الخير، هذا دوامك اليوم",
      body: "محاضرة واحدة · أولها هندسة البرمجيات الساعة 9:00 ص"
    });
  });

  it("يبني تذكيرًا لأحداث التقويم الجامعي قبل يوم", () => {
    const reminders = buildPushReminders(
      snapshot(),
      new Date("2026-10-01T00:00:00.000Z"),
      {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        classReminders: false,
        academicCalendar: true
      }
    );

    expect(reminders.find((item) => item.id === "smart:calendar:2026-10-04")).toEqual({
      id: "smart:calendar:2026-10-04",
      dueAt: "2026-10-03T15:00:00.000Z",
      title: "مواعيد جامعية مهمة غدًا",
      body: "بداية العام الجامعي وبدء دوام أعضاء هيئة التدريس • فترة السحب والإضافة • فترة الامتحانات التعويضية (غير المكتمل والتكميلي)",
      url: "/calendar"
    });
  });

  it("يبني إشعار انتهاء الدوام بعد آخر محاضرة", () => {
    const reminders = buildPushReminders(
      snapshot(),
      new Date("2026-10-03T12:00:00.000Z"),
      {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        classReminders: false,
        dayComplete: true
      }
    );

    expect(reminders.find((item) => item.id === "smart:complete:2026-10-04")).toMatchObject({
      dueAt: "2026-10-04T07:10:00.000Z",
      title: "خلص دوامك لليوم"
    });
  });

  it("يفك مفتاح VAPID بصيغة base64url", () => {
    expect(Array.from(base64UrlToUint8Array("AQIDBA"))).toEqual([1, 2, 3, 4]);
  });

  it("يقارن رمز الجهاز باستخدام بصمة ثابتة الطول", () => {
    const token = "a".repeat(43);
    const hash = hashDeviceToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(safeTokenHashMatches(hash, token)).toBe(true);
    expect(safeTokenHashMatches(hash, "b".repeat(43))).toBe(false);
  });

  it("يرفض مسارات الإشعارات الخارجية أو الشبيهة بمسار protocol-relative", () => {
    const base = {
      deviceId: "44444444-4444-4444-8444-444444444444",
      deviceToken: "a".repeat(43),
      title: "تنبيه",
      body: "اختبار"
    };

    expect(PushBroadcastRequestSchema.safeParse({ ...base, url: "/schedule" }).success).toBe(true);
    expect(PushBroadcastRequestSchema.safeParse({ ...base, url: "//evil.example" }).success).toBe(false);
    expect(PushBroadcastRequestSchema.safeParse({ ...base, url: "/\\evil.example" }).success).toBe(false);
  });

  it("يتحقق من محتوى الإشعار العام وحدوده", () => {
    const parsed = PushBroadcastRequestSchema.parse({
      deviceId: "44444444-4444-4444-8444-444444444444",
      deviceToken: "a".repeat(43),
      title: "  إشعار تجريبي  ",
      body: "من صهيب إلى جميع الأجهزة"
    });

    expect(parsed.title).toBe("إشعار تجريبي");
    expect(parsed.url).toBe("/");
    expect(PushBroadcastRequestSchema.safeParse({
      ...parsed,
      body: "x".repeat(241)
    }).success).toBe(false);
  });
});

