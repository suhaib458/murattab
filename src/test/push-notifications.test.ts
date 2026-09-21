import { describe, expect, it } from "vitest";
import { buildPushReminders, base64UrlToUint8Array } from "@/features/notifications/push-client";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import { hashDeviceToken, safeTokenHashMatches } from "@/server/push/supabase-rest";

const termId = "22222222-2222-4222-8222-222222222222";
const courseId = "11111111-1111-4111-8111-111111111111";
const sessionId = "33333333-3333-4333-8333-333333333333";

function snapshot(reminderEnabled = true): AppSnapshot {
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
      reminder: { enabled: reminderEnabled, minutesBefore: 15 },
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
      title: "محاضرة هندسة البرمجيات",
      body: "تبدأ بعد 15 دقيقة · مجمع القاعات – قاعة 207",
      url: "/schedule"
    });
    expect(JSON.stringify(reminders)).not.toContain("طالب");
  });

  it("لا ينشئ تذكيرات للمواد التي أوقف المستخدم تنبيهها", () => {
    expect(buildPushReminders(snapshot(false), new Date("2026-10-01T00:00:00.000Z"))).toEqual([]);
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
});

