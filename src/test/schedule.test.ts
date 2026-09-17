import { describe, expect, it } from "vitest";
import {
  parseDayCodes,
  formatArabicTime,
  expandRoom,
  hasConflict,
  findConflicts,
  makeSessions,
  sortSessions,
  dayNames,
  orderedDays,
  getFloorLabel,
  calculateFreeTimeSlots,
  formatDurationMinutes
} from "@/domain/schedule";
import { AcademicTermSchema, ClassSessionSchema } from "@/domain/models";
import { getFirstOccurrenceDate } from "@/domain/calendar";
import { makeBackup, readBackup } from "@/domain/backup";

const courseId = "11111111-1111-4111-8111-111111111111";
const termId = "22222222-2222-4222-8222-222222222222";
const baseSession = {
  id: "33333333-3333-4333-8333-333333333333",
  courseId,
  day: "ح" as const,
  startsAt: "09:00",
  endsAt: "10:00",
  room: expandRoom("207 م"),
  kind: "lecture" as const
};

describe("الجدول ومنطق المجال في مرتب", () => {
  describe("رموز الأيام وأسماؤها", () => {
    it("يتضمن جميع الرموز المؤكدة الستة", () => {
      expect(orderedDays).toEqual(["س", "ح", "ن", "ث", "ر", "خ"]);
      expect(dayNames["س"]).toBe("السبت");
      expect(dayNames["ح"]).toBe("الأحد");
      expect(dayNames["ن"]).toBe("الاثنين");
      expect(dayNames["ث"]).toBe("الثلاثاء");
      expect(dayNames["ر"]).toBe("الأربعاء");
      expect(dayNames["خ"]).toBe("الخميس");
    });

    it("يفسر ويزيل التكرار في رموز الأيام", () => {
      expect(parseDayCodes("حنحخ")).toEqual(["ح", "ن", "خ"]);
      expect(parseDayCodes("سحمث")).toEqual(["س", "ح", "ث"]);
    });
  });

  describe("تحويل الوقت العربي 12 ساعة", () => {
    it("يحول أوقات الصباح والمساء ومنتصف الليل والظهيرة بدقة", () => {
      expect(formatArabicTime("00:00")).toBe("12:00 ص");
      expect(formatArabicTime("00:05")).toBe("12:05 ص");
      expect(formatArabicTime("08:30")).toBe("8:30 ص");
      expect(formatArabicTime("11:45")).toBe("11:45 ص");
      expect(formatArabicTime("12:00")).toBe("12:00 م");
      expect(formatArabicTime("13:30")).toBe("1:30 م");
      expect(formatArabicTime("23:59")).toBe("11:59 م");
    });
  });

  describe("قواعد توسيع القاعات لجامعة الطفيلة التقنية", () => {
    it("يوسع مجمع القاعات (م) ورقم الطابق", () => {
      const room = expandRoom("207 م");
      expect(room.label).toBe("مجمع القاعات – قاعة 207");
      expect(room.isOnline).toBe(false);
      expect(getFloorLabel("207")).toBe("الطابق الثاني");
    });

    it("يوسع كلية الهندسة (هـ)", () => {
      const room = expandRoom("105 هـ");
      expect(room.label).toBe("كلية الهندسة – قاعة 105");
      expect(room.isOnline).toBe(false);
      expect(getFloorLabel("105")).toBe("الطابق الأول");
    });

    it("يوسع كلية الأعمال (ع)", () => {
      const room = expandRoom("302 ع");
      expect(room.label).toBe("كلية الأعمال – قاعة 302");
      expect(room.isOnline).toBe(false);
      expect(getFloorLabel("302")).toBe("الطابق الثالث");
    });

    it("يتعرف على جلسات الإنترنت Online", () => {
      expect(expandRoom("online").isOnline).toBe(true);
      expect(expandRoom("ONLINE").label).toBe("عبر الإنترنت");
      expect(expandRoom("عبر الإنترنت").isOnline).toBe(true);
      expect(expandRoom("أونلاين").isOnline).toBe(true);
    });

    it("يحافظ على القاعات غير المعروفة دون تعديل في السياق العادي", () => {
      expect(expandRoom("مدرج الكندي").label).toBe("مدرج الكندي");
      expect(expandRoom("207 م", false).label).toBe("207 م");
    });
  });

  describe("المواد متعددة الأيام والجلسات", () => {
    it("ينشئ جلسات منفصلة لكل يوم محدد بنفس courseId", () => {
      const sessions = makeSessions({
        courseId,
        days: ["ح", "ث", "خ"],
        startsAt: "10:00",
        endsAt: "11:00",
        room: expandRoom("105 هـ"),
        kind: "lecture"
      });
      expect(sessions).toHaveLength(3);
      expect(sessions.map((s) => s.day)).toEqual(["ح", "ث", "خ"]);
      expect(new Set(sessions.map((s) => s.id)).size).toBe(3);
      expect(sessions.every((s) => s.courseId === courseId)).toBe(true);
    });

    it("يرتب الجلسات تصاعديًا حسب وقت البداية", () => {
      const s1 = { ...baseSession, id: "1", startsAt: "08:00", endsAt: "09:00" };
      const s2 = { ...baseSession, id: "2", startsAt: "11:00", endsAt: "12:00" };
      const s3 = { ...baseSession, id: "3", startsAt: "09:30", endsAt: "10:30" };
      const sorted = sortSessions([s2, s1, s3]);
      expect(sorted.map((s) => s.id)).toEqual(["1", "3", "2"]);
    });
  });

  describe("اكتشاف التعارض الزمني", () => {
    it("يكتشف التعارض المتداخل في نفس اليوم", () => {
      const overlapping = { ...baseSession, id: "55555555-5555-4555-8555-555555555555", startsAt: "09:30", endsAt: "11:00" };
      expect(hasConflict(overlapping, [baseSession])).toBe(true);
    });

    it("لا يعتبر الجلسات المتتالية مباشرة تعارضًا (10:00-11:00 و 11:00-12:00)", () => {
      const contiguous = { ...baseSession, id: "66666666-6666-4666-8666-666666666666", startsAt: "10:00", endsAt: "11:00" };
      expect(hasConflict(contiguous, [baseSession])).toBe(false);
    });

    it("يكتشف التعارض إذا زاد وقت الجلسة دقيقة واحدة فقط (09:00-10:01 مع 10:00-11:00)", () => {
      const sessionA = { ...baseSession, startsAt: "09:00", endsAt: "10:01" };
      const sessionB = { ...baseSession, id: "b", startsAt: "10:00", endsAt: "11:00" };
      expect(hasConflict(sessionB, [sessionA])).toBe(true);
    });

    it("لا يعتبر الجلسات في نفس التوقيت بأيام مختلفة تعارضًا", () => {
      const otherDay = { ...baseSession, id: "77777777-7777-4777-8777-777777777777", day: "ث" as const };
      expect(hasConflict(otherDay, [baseSession])).toBe(false);
    });

    it("يستثني المادة الجاري تعديلها لمنع تعارضها مع جلساتها السابقة", () => {
      const conflicts = findConflicts([baseSession], [baseSession], courseId);
      expect(conflicts).toHaveLength(0);
    });
  });

  describe("حساب فترات الفراغ بين المحاضرات", () => {
    it("يحسب فترة الاستراحة بدقة بين جلستين غير متتاليتين", () => {
      const s1 = { ...baseSession, startsAt: "08:00", endsAt: "09:00" };
      const s2 = { ...baseSession, startsAt: "11:00", endsAt: "12:00" };
      const slots = calculateFreeTimeSlots([s1, s2]);
      expect(slots).toHaveLength(1);
      expect(slots[0]).toEqual({
        startsAt: "09:00",
        endsAt: "11:00",
        durationMinutes: 120
      });
      expect(formatDurationMinutes(120)).toBe("ساعتان");
      expect(formatDurationMinutes(90)).toBe("ساعة ونصف");
      expect(formatDurationMinutes(30)).toBe("30 دقيقة");
    });

    it("لا يولد فترات فراغ للمحاضرات المتتالية مباشرة", () => {
      const s1 = { ...baseSession, startsAt: "09:00", endsAt: "10:00" };
      const s2 = { ...baseSession, startsAt: "10:00", endsAt: "11:00" };
      expect(calculateFreeTimeSlots([s1, s2])).toHaveLength(0);
    });
  });

  describe("التحقق من صحة النماذج (Zod Schemas)", () => {
    it("يرفض جلسة يكون وقت نهايتها قبل وقت بدايتها أو مساويًا له", () => {
      expect(ClassSessionSchema.safeParse({ ...baseSession, endsAt: "08:00" }).success).toBe(false);
      expect(ClassSessionSchema.safeParse({ ...baseSession, endsAt: "09:00" }).success).toBe(false);
    });

    it("يرفض فصلًا أكاديميًا ينتهي قبل بدايته", () => {
      expect(
        AcademicTermSchema.safeParse({
          id: termId,
          name: "فصل تالف",
          startsOn: "2026-10-01",
          endsOn: "2026-09-01",
          isCurrent: true
        }).success
      ).toBe(false);
    });
  });

  describe("النسخ الاحتياطي والاستعادة", () => {
    it("ينشئ ويتحقق من نسخة احتياطية صالحة", () => {
      const settings = {
        id: "settings" as const,
        theme: "system" as const,
        onboardingComplete: true,
        splashShown: true,
        activeTermId: termId,
        guideSeen: true,
        schemaVersion: 1 as const
      };
      const backup = makeBackup({ profile: null, settings, terms: [], courses: [], sessions: [] });
      expect(readBackup(backup).success).toBe(true);
    });

    it("يرفض ملفًا تالفًا أو خاليًا أو بمخطط غير متوافق", () => {
      expect(readBackup({}).success).toBe(false);
      expect(readBackup({ schemaVersion: 99 }).success).toBe(false);
      expect(readBackup(null).success).toBe(false);
      expect(readBackup("invalid json string").success).toBe(false);
    });
  });

  describe("توليد ملفات التقويم (ICS) وفق RFC 5545", () => {
    // Phase 3C: production first-semester 2026/2027 dates (teaching start).
    const term = { id: termId, name: "الفصل الدراسي الأول 2026/2027", startsOn: "2026-10-04", endsOn: "2027-01-07", isCurrent: true };
    const course = {
      id: courseId,
      termId,
      name: "برمجة الويب",
      reminder: { enabled: true, minutesBefore: 15 },
      createdAt: "2026-10-04T00:00:00.000Z"
    };

    it("يحسب تاريخ أول تكرار (DTSTART) يطابق يوم المحاضرة الفعلي", () => {
      // 2026-10-04 هو يوم أحد (ح)
      // لجلسة الأحد (ح) عند term.startsOn = 2026-10-04، يجب أن يكون أول تاريخ 2026-10-04
      const sundayFirstDate = getFirstOccurrenceDate(term.startsOn, "ح");
      expect(sundayFirstDate).toBe("20261004");

      // لجلسة الثلاثاء (ث)، أول تاريخ بعد 2026-10-04 هو 2026-10-06
      const tuesdayFirstDate = getFirstOccurrenceDate(term.startsOn, "ث");
      expect(tuesdayFirstDate).toBe("20261006");
    });
  });
});

