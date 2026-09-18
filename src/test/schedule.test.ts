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
  formatDurationMinutes,
  getDayCodeFromJsDay,
  formatArabicDuration,
  getCurrentSession,
  getUpcomingSession,
  getMinutesRemainingInSession,
  getMinutesUntilSession,
  getNextScheduledSession,
  getFreeTimeIntelligence
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

  describe("ذكاء اليوم والجدول الزمني (Today Intelligence)", () => {
    describe("تنسيق المدة باللغة العربية (formatArabicDuration)", () => {
      it("ينسق الدقائق المفردة والجمع وفق القواعد المطلوبة بدقة", () => {
        expect(formatArabicDuration(0)).toBe("أقل من دقيقة");
        expect(formatArabicDuration(1)).toBe("دقيقة");
        expect(formatArabicDuration(2)).toBe("دقيقتان");
        expect(formatArabicDuration(8)).toBe("8 دقائق");
        expect(formatArabicDuration(10)).toBe("10 دقائق");
        expect(formatArabicDuration(45)).toBe("45 دقيقة");
        expect(formatArabicDuration(60)).toBe("ساعة");
        expect(formatArabicDuration(75)).toBe("ساعة و15 دقيقة");
        expect(formatArabicDuration(120)).toBe("ساعتان");
        expect(formatArabicDuration(150)).toBe("ساعتان و30 دقيقة");
        expect(formatArabicDuration(180)).toBe("3 ساعات");
        expect(formatArabicDuration(195)).toBe("3 ساعات و15 دقيقة");
        expect(formatArabicDuration(660)).toBe("11 ساعة");
      });
    });

    describe("تحديد المحاضرة الحالية والقادمة وشروط الحدود", () => {
      const lecture1 = { ...baseSession, id: "lec1", startsAt: "09:00", endsAt: "10:00" };
      const lecture2 = { ...baseSession, id: "lec2", startsAt: "11:00", endsAt: "12:30" };
      const sessions = [lecture1, lecture2];

      it("المحاضرة الحالية نشطة عندما startsAt <= now < endsAt", () => {
        expect(getCurrentSession(sessions, "09:30")?.id).toBe("lec1");
        expect(getMinutesRemainingInSession(lecture1, "09:30")).toBe(30);
      });

      it("شرط البداية: في لحظة البداية تمامًا (09:00) تعتبر المحاضرة نشطة وحالية", () => {
        expect(getCurrentSession(sessions, "09:00")?.id).toBe("lec1");
        expect(getMinutesRemainingInSession(lecture1, "09:00")).toBe(60);
      });

      it("شرط النهاية: في لحظة النهاية تمامًا (10:00) لا تعتبر المحاضرة حالية", () => {
        expect(getCurrentSession(sessions, "10:00")).toBeNull();
      });

      it("تحديد المحاضرة القادمة لاحقًا اليوم وحساب الوقت المتبقي حتى بدئها", () => {
        expect(getUpcomingSession(sessions, "08:15")?.id).toBe("lec1");
        expect(getMinutesUntilSession(lecture1, "08:15")).toBe(45);

        // بين المحاضرتين (10:15) القادمة هي lecture2
        expect(getUpcomingSession(sessions, "10:15")?.id).toBe("lec2");
        expect(getMinutesUntilSession(lecture2, "10:15")).toBe(45);
      });

      it("انتهاء جميع محاضرات اليوم عند تجاوز وقت نهاية آخر محاضرة", () => {
        expect(getCurrentSession(sessions, "12:30")).toBeNull();
        expect(getUpcomingSession(sessions, "12:30")).toBeNull();
        expect(getCurrentSession(sessions, "13:00")).toBeNull();
        expect(getUpcomingSession(sessions, "13:00")).toBeNull();
      });
    });

    describe("البحث عن الجلسة الدراسية القادمة عبر الأيام (getNextScheduledSession)", () => {
      const sundaySession = { ...baseSession, id: "sun1", day: "ح" as const, startsAt: "09:30", endsAt: "11:00" };
      const tuesdaySession = { ...baseSession, id: "tue1", day: "ث" as const, startsAt: "10:00", endsAt: "11:00" };
      const thursdaySession = { ...baseSession, id: "thu1", day: "خ" as const, startsAt: "08:30", endsAt: "10:00" };
      const allSessions = [sundaySession, tuesdaySession, thursdaySession];

      it("يعيد جلسة اليوم القادمة إذا كانت متبقية اليوم (daysAhead = 0)", () => {
        // الأحد الساعة 08:00 صباحًا (jsDay: 0 = Sun)
        const next = getNextScheduledSession(allSessions, 0, "08:00");
        expect(next).not.toBeNull();
        expect(next?.session.id).toBe("sun1");
        expect(next?.dayCode).toBe("ح");
        expect(next?.dayName).toBe("الأحد");
        expect(next?.daysAhead).toBe(0);
      });

      it("يعيد جلسة اليوم التالي إذا انتهت محاضرات اليوم (الأحد بعد المحاضرة -> الثلاثاء)", () => {
        // الأحد الساعة 12:00 ظهرًا (محاضرات الأحد انتهت)
        const next = getNextScheduledSession(allSessions, 0, "12:00");
        expect(next).not.toBeNull();
        expect(next?.session.id).toBe("tue1");
        expect(next?.dayCode).toBe("ث");
        expect(next?.dayName).toBe("الثلاثاء");
        expect(next?.daysAhead).toBe(2);
      });

      it("يتخطى يوم الجمعة كعطلة رسمية (الخميس بعد المحاضرة -> يتخطى الجمعة والسبت -> الأحد)", () => {
        // الخميس الساعة 11:00 (jsDay: 4 = Thu) بعد انتهاء محاضرة الخميس
        const next = getNextScheduledSession(allSessions, 4, "11:00");
        expect(next).not.toBeNull();
        expect(next?.session.id).toBe("sun1");
        expect(next?.dayCode).toBe("ح");
        expect(next?.dayName).toBe("الأحد");
        expect(next?.daysAhead).toBe(3); // الجمعة (skip), السبت (no class), الأحد (sun1) -> 3 days ahead
      });

      it("يتعامل مع يوم الجمعة ويبحث عن أول جلسة في الأيام اللاحقة", () => {
        // الجمعة (jsDay: 5)
        const next = getNextScheduledSession(allSessions, 5, "10:00");
        expect(next).not.toBeNull();
        expect(next?.session.id).toBe("sun1");
        expect(next?.dayCode).toBe("ح");
        expect(next?.daysAhead).toBe(2); // السبت (no class), الأحد (sun1)
      });

      it("يلتف حول الأسبوع (Wrap-around) إذا لم تبق محاضرات حتى الأسبوع التالي", () => {
        // جدول فيه محاضرة واحدة فقط يوم الثلاثاء
        const singleSchedule = [tuesdaySession];
        // نحن يوم الأربعاء (jsDay: 3)
        const next = getNextScheduledSession(singleSchedule, 3, "08:00");
        expect(next).not.toBeNull();
        expect(next?.session.id).toBe("tue1");
        expect(next?.dayCode).toBe("ث");
        expect(next?.daysAhead).toBe(6); // خميس، جمعة، سبت، أحد، اثنين، ثلاثاء -> 6 days ahead
      });

      it("يعيد null إذا كان الجدول فارغًا تمامًا دون جلسات", () => {
        expect(getNextScheduledSession([], 0, "08:00")).toBeNull();
        expect(getNextScheduledSession([], 4, "15:00")).toBeNull();
        expect(getNextScheduledSession([], 5, "12:00")).toBeNull();
      });
    });

    describe("ذكاء فترات الفراغ (getFreeTimeIntelligence)", () => {
      const s1 = { ...baseSession, id: "s1", startsAt: "08:30", endsAt: "10:00" };
      const s2 = { ...baseSession, id: "s2", startsAt: "11:30", endsAt: "13:00" };
      const s3 = { ...baseSession, id: "s3", startsAt: "14:00", endsAt: "15:00" };
      const sessions = [s1, s2, s3];

      it("يكتشف وجود الطالب حاليًا في فترة فراغ بين المحاضرات ويحسب الوقت المتبقي", () => {
        // الساعة 10:40 (بين s1 التي تنتهي 10:00 و s2 التي تبدأ 11:30)
        const info = getFreeTimeIntelligence(sessions, "10:40");
        expect(info.status).toBe("current");
        if (info.status === "current") {
          expect(info.currentSlot.startsAt).toBe("10:00");
          expect(info.currentSlot.endsAt).toBe("11:30");
          expect(info.minutesRemaining).toBe(50); // 11:30 - 10:40 = 50 min
        }
      });

      it("يكتشف فترة الفراغ القادمة لاحقًا أثناء حضور محاضرة", () => {
        // الساعة 09:00 (خلال s1 08:30-10:00)
        const info = getFreeTimeIntelligence(sessions, "09:00");
        expect(info.status).toBe("upcoming");
        if (info.status === "upcoming") {
          expect(info.nextSlot.startsAt).toBe("10:00");
          expect(info.nextSlot.endsAt).toBe("11:30");
          expect(info.minutesUntil).toBe(60); // 10:00 - 09:00 = 60 min
        }
      });

      it("يعيد status: none عندما لا توجد فترات فراغ متبقية اليوم أو عند عدم وجود استراحات", () => {
        // الساعة 14:30 (خلال s3، ولا توجد فترات فراغ بعدها)
        expect(getFreeTimeIntelligence(sessions, "14:30").status).toBe("none");

        // محاضرات متتالية بدون فراغ
        const backToBack = [
          { ...baseSession, id: "b1", startsAt: "08:00", endsAt: "09:00" },
          { ...baseSession, id: "b2", startsAt: "09:00", endsAt: "10:00" }
        ];
        expect(getFreeTimeIntelligence(backToBack, "08:30").status).toBe("none");
      });
    });
  });
});


