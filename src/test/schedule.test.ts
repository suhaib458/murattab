import { describe, expect, it } from "vitest";
import { parseDayCodes, formatArabicTime, expandRoom, hasConflict, makeSessions, sortSessions } from "@/domain/schedule";
import { ClassSessionSchema } from "@/domain/models";
import { generateIcs } from "@/domain/calendar";
import { makeBackup, readBackup } from "@/domain/backup";

const courseId = "11111111-1111-4111-8111-111111111111"; const termId = "22222222-2222-4222-8222-222222222222";
const base = { id: "33333333-3333-4333-8333-333333333333", courseId, day: "ح" as const, startsAt: "09:00", endsAt: "10:00", room: expandRoom("207 م"), kind: "lecture" as const };
describe("الجدول", () => {
  it("يفسر رموز الأيام", () => expect(parseDayCodes("حنحخ")).toEqual(["ح", "ن", "خ"]));
  it("يعرض الوقت العربي", () => { expect(formatArabicTime("00:05")).toBe("12:05 ص"); expect(formatArabicTime("13:30")).toBe("1:30 م"); });
  it("يوسع القاعة داخل سياقها فقط", () => { expect(expandRoom("207 م").label).toBe("مجمع القاعات – قاعة 207"); expect(expandRoom("207 م", false).label).toBe("207 م"); });
  it("يقسم المادة متعددة الأيام", () => expect(makeSessions({ courseId, days: ["ح", "ث"], startsAt: "09:00", endsAt: "10:00", room: expandRoom("Online"), kind: "lecture" })).toHaveLength(2));
  it("يرتب ويكشف التعارض", () => { const late = { ...base, id: "44444444-4444-4444-8444-444444444444", startsAt: "12:00", endsAt: "13:00" }; expect(sortSessions([late, base])[0].id).toBe(base.id); expect(hasConflict({ ...base, id: "55555555-5555-4555-8555-555555555555", startsAt: "09:30", endsAt: "11:00" }, [base])).toBe(true); });
  it("يرفض جلسة غير صالحة", () => expect(ClassSessionSchema.safeParse({ ...base, endsAt: "08:00" }).success).toBe(false));
  it("ينشئ ويقرأ نسخة احتياطية", () => { const settings = { id: "settings" as const, theme: "system" as const, onboardingComplete: true, splashShown: true, activeTermId: termId, guideSeen: true, schemaVersion: 1 as const }; const backup = makeBackup({ profile: null, settings, terms: [], courses: [], sessions: [] }); expect(readBackup(backup).success).toBe(true); expect(readBackup({}).success).toBe(false); });
  it("يولد ICS ضمن الفصل", () => { const term = { id: termId, name: "الأول", startsOn: "2026-09-01", endsOn: "2026-12-31", isCurrent: true }; const course = { id: courseId, termId, name: "برمجة", reminder: { enabled: true, minutesBefore: 10 }, createdAt: "2026-09-01T00:00:00.000Z" }; const ics = generateIcs([course], [base], term); expect(ics).toContain("UNTIL=20261231T235959Z"); expect(ics).toContain("SUMMARY:برمجة"); });
});
