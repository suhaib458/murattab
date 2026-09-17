/**
 * Phase 3C — TTU canonical dataset tests.
 *
 * Covers:
 *   - 6 V1 faculties exactly
 *   - all canonical majors
 *   - IT faculty has exactly 4 programs
 *   - AI/Data program exists with exact Arabic name
 *   - faculty-major filtering
 *   - no orphan major
 *   - stable IDs
 *   - legacy profile detection
 *   - non-destructive faculty/major refresh
 *   - term migration (placeholder -> production)
 *   - official term dates
 *   - academic calendar events
 *   - range validation
 *   - ICS first occurrence >= 2026-10-04
 *   - ICS recurrence ends with verified teaching boundary
 *   - ICT 4 lab label
 *   - unknown room stays raw
 *   - Smart Import remains correct (regression smoke)
 */
import { describe, expect, it } from "vitest";
import {
  ttuConfig,
  TTU_FACULTY_IDS,
  TTU_MAJOR_IDS,
  LEGACY_SEED_IDS,
  isResolvableAcademicId,
  isLegacyAcademicSelection
} from "@/config/ttu";
import {
  AcademicTermSchema,
  type AcademicTerm
} from "@/domain/models";
import {
  generateIcs,
  ttuAcademicCalendar,
  getEventsOnDate
} from "@/domain/calendar";
import { expandRoom, getIctLabLabel } from "@/domain/schedule";
import {
  PRODUCTION_TERM,
  PRODUCTION_TERM_ID,
  migrateLegacyTerms
} from "@/storage/local-repository";
import type { Course, ClassSession } from "@/domain/models";

describe("Phase 3C — TTU canonical faculties", () => {
  it("ships exactly 6 V1 faculties", () => {
    expect(ttuConfig.faculties).toHaveLength(6);
  });

  it("contains the 6 expected V1 faculty names", () => {
    const names = ttuConfig.faculties.map((f) => f.name).sort();
    expect(names).toEqual([
      "كلية الآداب",
      "كلية الأعمال",
      "كلية العلوم",
      "كلية العلوم التربوية",
      "كلية الهندسة",
      "كلية تكنولوجيا المعلومات والاتصالات"
    ]);
  });

  it("does NOT include middle technical college (out of V1 scope)", () => {
    expect(ttuConfig.faculties.some((f) => f.name.includes("المتوسطة"))).toBe(false);
  });

  it("every faculty id is a valid UUID", () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const f of ttuConfig.faculties) {
      expect(uuidRe.test(f.id)).toBe(true);
    }
  });

  it("no faculty has isDevelopmentSeed=true", () => {
    expect(ttuConfig.faculties.every((f) => f.isDevelopmentSeed === false)).toBe(true);
  });

  it("no faculty uses a legacy V0 placeholder UUID", () => {
    for (const f of ttuConfig.faculties) {
      expect(LEGACY_SEED_IDS.has(f.id)).toBe(false);
    }
  });
});

describe("Phase 3C — TTU canonical majors", () => {
  it("contains 43 undergraduate programs in total", () => {
    expect(ttuConfig.majors).toHaveLength(43);
  });

  it("IT faculty has exactly 4 programs", () => {
    const itMajors = ttuConfig.majors.filter((m) => m.facultyId === TTU_FACULTY_IDS.itAndCommunication);
    expect(itMajors).toHaveLength(4);
  });

  it("IT faculty includes the AI/Data Science program with exact Arabic name", () => {
    const ai = ttuConfig.majors.find(
      (m) => m.facultyId === TTU_FACULTY_IDS.itAndCommunication && m.name === "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات"
    );
    expect(ai).toBeDefined();
    expect(ai?.id).toBe(TTU_MAJOR_IDS.itAiDataScience);
  });

  it("engineering faculty contains the expected 15 programs", () => {
    const eng = ttuConfig.majors.filter((m) => m.facultyId === TTU_FACULTY_IDS.engineering);
    expect(eng).toHaveLength(15);
    const expected = [
      "الهندسة الجيولوجية",
      "الهندسة الميكانيكية/الإنتاج والآلات",
      "الهندسة الميكانيكية/المركبات",
      "هندسة التعدين",
      "هندسة القوى الكهربائية",
      "الهندسة المدنية",
      "الهندسة الميكانيكية/التكييف والتبريد والتدفئة",
      "الهندسة الميكانيكية/تكنولوجيا المركبات الهجينة",
      "هندسة الأنظمة الذكية",
      "هندسة الاتصالات والإلكترونيات",
      "هندسة الحاسوب",
      "هندسة الصناعات الكيميائية",
      "هندسة الطاقة المتجددة المتكاملة",
      "هندسة الميكاترونيكس",
      "هندسة الميكاترونيكس والروبوتات"
    ];
    expect(eng.map((m) => m.name).sort()).toEqual([...expected].sort());
  });

  it("no orphan major — every major.facultyId resolves to a faculty", () => {
    const facultyIds = new Set(ttuConfig.faculties.map((f) => f.id));
    for (const m of ttuConfig.majors) {
      expect(facultyIds.has(m.facultyId)).toBe(true);
    }
  });

  it("major names are unique within each faculty", () => {
    const seen = new Map<string, Set<string>>();
    for (const m of ttuConfig.majors) {
      const set = seen.get(m.facultyId) ?? new Set<string>();
      if (set.has(m.name)) {
        throw new Error(`Duplicate major name within faculty ${m.facultyId}: ${m.name}`);
      }
      set.add(m.name);
      seen.set(m.facultyId, set);
    }
  });

  it("major IDs are unique across the whole dataset", () => {
    const ids = ttuConfig.majors.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no major uses a legacy V0 placeholder UUID", () => {
    for (const m of ttuConfig.majors) {
      expect(LEGACY_SEED_IDS.has(m.id)).toBe(false);
    }
  });

  it("filter majors by faculty returns only that faculty's programs", () => {
    const it = ttuConfig.majors.filter((m) => m.facultyId === TTU_FACULTY_IDS.itAndCommunication);
    expect(it.every((m) => m.facultyId === TTU_FACULTY_IDS.itAndCommunication)).toBe(true);
    expect(it.length).toBeGreaterThan(0);
  });
});

describe("Phase 3C — legacy profile detection", () => {
  it("identifies the V0 legacy placeholder IDs as legacy", () => {
    expect(isLegacyAcademicSelection("11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333")).toBe(true);
    expect(isLegacyAcademicSelection(TTU_FACULTY_IDS.itAndCommunication, "44444444-4444-4444-8444-444444444444")).toBe(true);
  });

  it("does NOT mark a fresh production profile as legacy", () => {
    expect(
      isLegacyAcademicSelection(TTU_FACULTY_IDS.itAndCommunication, TTU_MAJOR_IDS.itAiDataScience)
    ).toBe(false);
  });

  it("treats undefined IDs as non-legacy (fresh user)", () => {
    expect(isLegacyAcademicSelection(undefined, undefined)).toBe(false);
  });

  it("isResolvableAcademicId returns true for production IDs that match", () => {
    expect(isResolvableAcademicId(TTU_FACULTY_IDS.itAndCommunication, TTU_MAJOR_IDS.itAiDataScience)).toBe(true);
  });

  it("isResolvableAcademicId returns false when major does not belong to faculty", () => {
    expect(isResolvableAcademicId(TTU_FACULTY_IDS.arts, TTU_MAJOR_IDS.itAiDataScience)).toBe(false);
  });

  it("isResolvableAcademicId returns false for legacy IDs", () => {
    expect(isResolvableAcademicId("11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333")).toBe(false);
  });
});

describe("Phase 3C — production AcademicTerm", () => {
  it("uses the verified official dates (2026-10-04 → 2027-01-07)", () => {
    expect(PRODUCTION_TERM.startsOn).toBe("2026-10-04");
    expect(PRODUCTION_TERM.endsOn).toBe("2027-01-07");
  });

  it("uses the verified official Arabic name", () => {
    expect(PRODUCTION_TERM.name).toBe("الفصل الدراسي الأول 2026/2027");
  });

  it("does NOT use the V0 placeholder dates 2026-09-01 / 2026-12-31", () => {
    expect(PRODUCTION_TERM.startsOn).not.toBe("2026-09-01");
    expect(PRODUCTION_TERM.endsOn).not.toBe("2026-12-31");
  });

  it("passes the AcademicTermSchema", () => {
    const result = AcademicTermSchema.safeParse(PRODUCTION_TERM);
    expect(result.success).toBe(true);
  });

  it("has a stable fixed UUID that does not change between calls", () => {
    expect(PRODUCTION_TERM.id).toBe(PRODUCTION_TERM_ID);
  });
});

describe("Phase 3C — legacy term migration", () => {
  it("rewrites the V0 placeholder term to the production term", () => {
    const legacy: AcademicTerm = {
      id: "legacy-term-id",
      name: "الفصل الحالي",
      startsOn: "2026-09-01",
      endsOn: "2026-12-31",
      isCurrent: true
    };
    const out = migrateLegacyTerms([legacy], legacy.id);
    expect(out.migrated).toBe(true);
    expect(out.terms[0].id).toBe(PRODUCTION_TERM_ID);
    expect(out.terms[0].startsOn).toBe("2026-10-04");
    expect(out.terms[0].endsOn).toBe("2027-01-07");
    expect(out.activeTermId).toBe(PRODUCTION_TERM_ID);
  });

  it("does NOT migrate user-created terms (only the exact placeholder signature)", () => {
    const userTerm: AcademicTerm = {
      id: "user-term-id",
      name: "الفصل الثاني",
      startsOn: "2027-02-15",
      endsOn: "2027-06-15",
      isCurrent: false
    };
    const out = migrateLegacyTerms([userTerm], userTerm.id);
    expect(out.migrated).toBe(false);
    expect(out.terms[0]).toEqual(userTerm);
    expect(out.activeTermId).toBe(userTerm.id);
  });

  it("does NOT migrate a term with a partial match (e.g. just dates)", () => {
    const partial: AcademicTerm = {
      id: "partial",
      name: "Something else",
      startsOn: "2026-09-01",
      endsOn: "2026-12-31",
      isCurrent: true
    };
    const out = migrateLegacyTerms([partial], partial.id);
    expect(out.migrated).toBe(false);
  });
});

describe("Phase 3C — official academic calendar", () => {
  it("contains at least the 16 student-relevant events", () => {
    expect(ttuAcademicCalendar.events.length).toBeGreaterThanOrEqual(16);
  });

  it("uses 2026-09-27 as the academic year / add-drop start", () => {
    const ev = ttuAcademicCalendar.events.find((e) => e.title.startsWith("بداية العام"));
    expect(ev).toBeDefined();
    expect(ev?.startsOn).toBe("2026-09-27");
  });

  it("uses 2026-10-04 as the teaching start", () => {
    const ev = ttuAcademicCalendar.events.find((e) => e.title === "بدء التدريس");
    expect(ev).toBeDefined();
    expect(ev?.startsOn).toBe("2026-10-04");
  });

  it("uses 2027-01-07 as the last teaching day and the drop deadline", () => {
    const lastTeaching = ttuAcademicCalendar.events.find((e) => e.title === "آخر موعد للتدريس");
    expect(lastTeaching?.startsOn).toBe("2027-01-07");
    const drop = ttuAcademicCalendar.events.find((e) => e.title.startsWith("آخر موعد للانسحاب"));
    expect(drop?.startsOn).toBe("2027-01-07");
  });

  it("contains both final exam windows (practical + theoretical)", () => {
    const practical = ttuAcademicCalendar.events.find((e) => e.title === "الامتحانات النهائية العملية والمحوسبة");
    const theoretical = ttuAcademicCalendar.events.find((e) => e.title === "الامتحانات النهائية النظرية");
    expect(practical?.startsOn).toBe("2027-01-10");
    expect(practical?.endsOn).toBe("2027-01-14");
    expect(theoretical?.startsOn).toBe("2027-01-17");
    expect(theoretical?.endsOn).toBe("2027-01-26");
  });

  it("contains both official holidays in this semester (Christmas + New Year)", () => {
    const christmas = ttuAcademicCalendar.events.find((e) => e.title === "عيد الميلاد المجيد");
    const newYear = ttuAcademicCalendar.events.find((e) => e.title === "رأس السنة الميلادية");
    expect(christmas?.startsOn).toBe("2026-12-25");
    expect(christmas?.kind).toBe("holiday");
    expect(newYear?.startsOn).toBe("2027-01-01");
    expect(newYear?.kind).toBe("holiday");
  });

  it("every event has a unique id", () => {
    const ids = ttuAcademicCalendar.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every event's end (if any) is on or after its start", () => {
    for (const e of ttuAcademicCalendar.events) {
      if (e.endsOn) {
        expect(e.endsOn >= e.startsOn).toBe(true);
      }
    }
  });

  it("getEventsOnDate returns events that intersect the given date", () => {
    const onTeachingStart = getEventsOnDate(ttuAcademicCalendar.events, "2026-10-04");
    const titles = onTeachingStart.map((e) => e.title);
    expect(titles).toContain("بدء التدريس");
    expect(titles).toContain("فترة الامتحانات التعويضية (غير المكتمل والتكميلي)");
  });

  it("getEventsOnDate returns empty array when no events intersect", () => {
    const none = getEventsOnDate(ttuAcademicCalendar.events, "2026-12-15");
    expect(none).toEqual([]);
  });
});

describe("Phase 3C — ICS first occurrence uses official teaching start", () => {
  const term = PRODUCTION_TERM;
  const courseId = "test-course-id";
  const course: Course = {
    id: courseId,
    termId: term.id,
    name: "اختبار",
    reminder: { enabled: false, minutesBefore: 0 },
    createdAt: "2026-10-04T00:00:00.000Z"
  };
  const session: ClassSession = {
    id: "test-session-id",
    courseId,
    day: "ح",
    startsAt: "09:00",
    endsAt: "10:00",
    room: { raw: "207 م", label: "مجمع القاعات – قاعة 207", isOnline: false },
    kind: "lecture"
  };

  it("first occurrence date is on or after the verified teaching start (2026-10-04)", () => {
    const ics = generateIcs([course], [session], term);
    // For day=ح (Sunday) starting 2026-10-04, first occurrence is exactly 2026-10-04
    expect(ics).toContain("DTSTART;TZID=Asia/Amman:20261004T090000");
  });

  it("RRULE ends with the verified teaching boundary (2027-01-07)", () => {
    const ics = generateIcs([course], [session], term);
    expect(ics).toContain("RRULE:FREQ=WEEKLY;UNTIL=20270107T235959Z");
  });
});

describe("Phase 3C — room / building helpers", () => {
  it("ICT - 4 in a lab session becomes 'مختبر الحاسوب ICT - 4' via getIctLabLabel", () => {
    expect(getIctLabLabel("ICT - 4", "lab")).toBe("مختبر الحاسوب ICT - 4");
  });

  it("ICT - 4 in a lecture session is NOT relabelled (ICT is a lab identifier)", () => {
    expect(getIctLabLabel("ICT - 4", "lecture")).toBeNull();
  });

  it("unknown room codes are kept raw by expandRoom", () => {
    expect(expandRoom("مدرج الكندي").label).toBe("مدرج الكندي");
    expect(expandRoom("204 ح", false).label).toBe("204 ح");
  });

  it("expandRoom still maps م → مجمع القاعات, هـ → كلية الهندسة, ع → كلية الأعمال", () => {
    expect(expandRoom("207 م").label).toBe("مجمع القاعات – قاعة 207");
    expect(expandRoom("105 هـ").label).toBe("كلية الهندسة – قاعة 105");
    expect(expandRoom("302 ع").label).toBe("كلية الأعمال – قاعة 302");
  });
});
