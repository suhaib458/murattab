import { describe, expect, it } from "vitest";
import type { TtuTableGeometryResult, TtuTableRow, TtuCellSegment } from "@/domain/ttu-table/types";
import {
  parseTtuScheduleSemantics,
  toScheduleExtractionResult,
  parseTtuDayCodes,
  parseTtuTimeRange,
  parseTtuRoom,
  classifySessionKind
} from "@/domain/ttu-schedule-parser";
import { ScheduleExtractionResultSchema } from "@/domain/models";

function makeSegment(text: string, y0: number, y1: number, confidence = 0.95): TtuCellSegment {
  return {
    text,
    bbox: { x0: 100, y0, x1: 500, y1 },
    confidence
  };
}

function makeRow(options: {
  index: number;
  y0: number;
  y1: number;
  courseName: string;
  meetingSegments?: TtuCellSegment[];
  meetingText?: string;
  roomSegments?: TtuCellSegment[];
  roomText?: string;
  sectionText?: string;
  creditHoursText?: string;
  confidence?: number;
}): TtuTableRow {
  const rowConfidence = options.confidence ?? 0.95;
  const mSegs = options.meetingSegments ?? (options.meetingText ? [makeSegment(options.meetingText, options.y0, options.y1, rowConfidence)] : []);
  const rSegs = options.roomSegments ?? (options.roomText ? [makeSegment(options.roomText, options.y0, options.y1, rowConfidence)] : []);

  return {
    index: options.index,
    bbox: { x0: 50, y0: options.y0, x1: 950, y1: options.y1 },
    confidence: rowConfidence,
    cells: {
      courseName: {
        column: "courseName",
        rawText: options.courseName,
        segments: [makeSegment(options.courseName, options.y0, options.y1, rowConfidence)],
        bbox: { x0: 700, y0: options.y0, x1: 950, y1: options.y1 },
        confidence: rowConfidence
      },
      section: options.sectionText
        ? {
            column: "section",
            rawText: options.sectionText,
            segments: [makeSegment(options.sectionText, options.y0, options.y1, rowConfidence)],
            bbox: { x0: 600, y0: options.y0, x1: 700, y1: options.y1 },
            confidence: rowConfidence
          }
        : undefined,
      creditHours: options.creditHoursText
        ? {
            column: "creditHours",
            rawText: options.creditHoursText,
            segments: [makeSegment(options.creditHoursText, options.y0, options.y1, rowConfidence)],
            bbox: { x0: 500, y0: options.y0, x1: 600, y1: options.y1 },
            confidence: rowConfidence
          }
        : undefined,
      meeting: {
        column: "meeting",
        rawText: mSegs.map((s) => s.text).join("\n"),
        segments: mSegs,
        bbox: { x0: 250, y0: options.y0, x1: 500, y1: options.y1 },
        confidence: rowConfidence
      },
      room: {
        column: "room",
        rawText: rSegs.map((s) => s.text).join("\n"),
        segments: rSegs,
        bbox: { x0: 50, y0: options.y0, x1: 250, y1: options.y1 },
        confidence: rowConfidence
      }
    }
  };
}

function makeGeometry(rows: TtuTableRow[]): TtuTableGeometryResult {
  return {
    columns: [],
    rows,
    issues: [],
    confidence: 0.95
  };
}

describe("TTU Schedule Semantic Parser (Phase 3)", () => {
  describe("Required Test Cases A–H", () => {
    it("CASE A — Logical circuits: preserves Sunday and Tuesday only (NO Thursday)", () => {
      const row = makeRow({
        index: 0,
        y0: 100,
        y1: 150,
        courseName: "تصميم الدوائر المنطقية",
        meetingText: "ح ث 11:30 - 13:00",
        roomText: "DS-ICT 2"
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      expect(parsed.courses).toHaveLength(1);

      const course = parsed.courses[0];
      expect(course.courseName).toBe("تصميم الدوائر المنطقية");
      expect(course.sessions).toHaveLength(2);

      const days = course.sessions.map((s) => s.day);
      expect(days).toEqual(["ح", "ث"]);
      expect(days).not.toContain("خ");

      for (const session of course.sessions) {
        expect(session.startsAt).toBe("11:30");
        expect(session.endsAt).toBe("13:00");
        expect(session.roomRaw).toBe("DS-ICT 2");
        expect(session.kind).toBe("unspecified");
      }
    });

    it("CASE B — Data Visualization: multi-session lecture (207 م) + lab (ICT - 4) with correct pairing", () => {
      const row = makeRow({
        index: 1,
        y0: 200,
        y1: 320,
        courseName: "تصور البيانات",
        meetingSegments: [
          makeSegment("ح ث خ 10:00 - 11:00", 210, 250),
          makeSegment("ن 08:30 - 10:30", 270, 310)
        ],
        roomSegments: [
          makeSegment("207 م", 210, 250),
          makeSegment("ICT - 4", 270, 310)
        ]
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      expect(parsed.courses).toHaveLength(1);

      const course = parsed.courses[0];
      expect(course.courseName).toBe("تصور البيانات");
      // Segment 0: 3 days (ح, ث, خ) -> 3 lecture sessions
      // Segment 1: 1 day (ن) -> 1 lab session
      expect(course.sessions).toHaveLength(4);

      // Lecture sessions (Sun, Tue, Thu)
      const lectureSessions = course.sessions.filter((s) => s.kind === "lecture");
      expect(lectureSessions).toHaveLength(3);
      expect(lectureSessions.map((s) => s.day)).toEqual(["ح", "ث", "خ"]);
      for (const sess of lectureSessions) {
        expect(sess.startsAt).toBe("10:00");
        expect(sess.endsAt).toBe("11:00");
        expect(sess.roomRaw).toBe("207 م");
        expect(sess.roomExpanded).toBe("مجمع القاعات – قاعة 207");
      }

      // Lab session (Mon)
      const labSessions = course.sessions.filter((s) => s.kind === "lab");
      expect(labSessions).toHaveLength(1);
      const labSess = labSessions[0];
      expect(labSess.day).toBe("ن");
      expect(labSess.startsAt).toBe("08:30");
      expect(labSess.endsAt).toBe("10:30");
      expect(labSess.roomRaw).toBe("ICT - 4");
      expect(labSess.roomExpanded).toBe("مختبر الحاسوب ICT - 4");
    });

    it("CASE C — Machine Learning: preserves Monday and Wednesday only", () => {
      const row = makeRow({
        index: 2,
        y0: 350,
        y1: 400,
        courseName: "التعلم الآلي",
        meetingText: "ن ر 11:30 - 13:00",
        roomText: "DS-ICT 3"
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      const course = parsed.courses[0];
      expect(course.courseName).toBe("التعلم الآلي");
      expect(course.sessions).toHaveLength(2);

      const days = course.sessions.map((s) => s.day);
      expect(days).toEqual(["ن", "ر"]);
      for (const sess of course.sessions) {
        expect(sess.startsAt).toBe("11:30");
        expect(sess.endsAt).toBe("13:00");
        expect(sess.roomRaw).toBe("DS-ICT 3");
      }
    });

    it("CASE D — Networks: preserves Sunday and Tuesday only (no invented Thursday)", () => {
      const row = makeRow({
        index: 3,
        y0: 450,
        y1: 500,
        courseName: "شبكات الحاسوب",
        meetingText: "ح ث 08:30 - 10:00",
        roomText: "DS-ICT 3"
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      const course = parsed.courses[0];
      expect(course.courseName).toBe("شبكات الحاسوب");
      expect(course.sessions).toHaveLength(2);

      const days = course.sessions.map((s) => s.day);
      expect(days).toEqual(["ح", "ث"]);
      expect(days).not.toContain("خ");
    });

    it("CASE E — Invalid reversed time: emits INVALID_TIME_RANGE and does not auto-swap", () => {
      const row = makeRow({
        index: 4,
        y0: 550,
        y1: 600,
        courseName: "أمن المعلومات",
        meetingText: "ح 11:00 - 10:30",
        roomText: "207 م"
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      const session = parsed.courses[0].sessions[0];
      expect(session.startsAt).toBeNull();
      expect(session.endsAt).toBeNull();

      const timeIssue = parsed.issues.find((i) => i.code === "INVALID_TIME_RANGE");
      expect(timeIssue).toBeDefined();
      expect(timeIssue?.severity).toBe("error");
    });

    it("CASE F — Missing room: creates session with empty roomRaw and ROOM_MISSING issue", () => {
      const row = makeRow({
        index: 5,
        y0: 650,
        y1: 700,
        courseName: "مقدمة في البرمجة",
        meetingText: "ح ث 10:00 - 11:00",
        roomText: ""
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      const sessions = parsed.courses[0].sessions;
      expect(sessions).toHaveLength(2);
      expect(sessions[0].roomRaw).toBe("");
      expect(sessions[0].roomExpanded).toBeUndefined();

      const roomIssue = parsed.issues.find((i) => i.code === "ROOM_MISSING");
      expect(roomIssue).toBeDefined();
      expect(roomIssue?.severity).toBe("warning");
    });

    it("CASE G — Mismatched segments: 2 meetings, 1 room does not duplicate room blindly", () => {
      // Meeting 0 at y=710, Meeting 1 at y=770. Room at y=710.
      const row = makeRow({
        index: 6,
        y0: 700,
        y1: 800,
        courseName: "تحليل وتصميم النظم",
        meetingSegments: [
          makeSegment("ح ث 10:00 - 11:00", 705, 735),
          makeSegment("ن 12:00 - 14:00", 765, 795)
        ],
        roomSegments: [
          makeSegment("207 م", 705, 735)
        ]
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      const course = parsed.courses[0];
      // Meeting 0 has 2 days (ح, ث)
      // Meeting 1 has 1 day (ن)
      expect(course.sessions).toHaveLength(3);

      // Meeting 0 sessions paired with 207 م
      const sunSess = course.sessions.find((s) => s.day === "ح");
      const tueSess = course.sessions.find((s) => s.day === "ث");
      expect(sunSess?.roomRaw).toBe("207 م");
      expect(tueSess?.roomRaw).toBe("207 م");

      // Meeting 1 session must NOT have 207 م duplicated!
      const monSess = course.sessions.find((s) => s.day === "ن");
      expect(monSess?.roomRaw).toBe("");
    });

    it("CASE H — Arabic-Indic digits: converts ٠٨:٣٠ - ١٠:٠٠ to 08:30 and 10:00", () => {
      const timeResult = parseTtuTimeRange("٠٨:٣٠ - ١٠:٠٠", 0.95);
      expect(timeResult.startsAt).toBe("08:30");
      expect(timeResult.endsAt).toBe("10:00");
      expect(timeResult.issues).toHaveLength(0);
    });
  });

  describe("Classification Rules (DS-ICT vs ICT vs Hall)", () => {
    it("classifies DS-ICT 2 and DS-ICT 3 as 'unspecified'", () => {
      const r1 = classifySessionKind("DS-ICT 2");
      expect(r1.kind).toBe("unspecified");
      expect(r1.issues.some((i) => i.code === "SESSION_KIND_UNSPECIFIED")).toBe(true);

      const r2 = classifySessionKind("DS-ICT 3");
      expect(r2.kind).toBe("unspecified");
    });

    it("classifies plain ICT - 4 and ICT 4 as 'lab'", () => {
      const r1 = classifySessionKind("ICT - 4");
      expect(r1.kind).toBe("lab");
      expect(r1.issues).toHaveLength(0);

      const r2 = classifySessionKind("ICT 4");
      expect(r2.kind).toBe("lab");
    });

    it("classifies 207 م as 'lecture'", () => {
      const roomParsed = parseTtuRoom("207 م");
      const r1 = classifySessionKind("207 م", roomParsed.roomExpanded);
      expect(r1.kind).toBe("lecture");
      expect(r1.issues).toHaveLength(0);
    });

    it("classifies explicit 'مختبر' text as 'lab'", () => {
      const r = classifySessionKind("مختبر الفيزياء 1");
      expect(r.kind).toBe("lab");
    });
  });

  describe("Real OCR Regression Fixture (Observed Smoke Test Feedback)", () => {
    it("handles real smoke test tokens without guessing", () => {
      // 1. "ح & 11:30 - 13:00" -> exact ح preserved, & is ambiguous, no ث invented
      const day1 = parseTtuDayCodes("ح & 11:30 - 13:00", 0.9);
      expect(day1.days).toEqual(["ح"]);
      expect(day1.days).not.toContain("ث");
      expect(day1.issues.some((i) => i.code === "DAY_TOKEN_AMBIGUOUS")).toBe(true);

      // 2. "© , 11:30 - 13:00" -> no days recovered, DAY_UNRESOLVED and DAY_TOKEN_AMBIGUOUS
      const day2 = parseTtuDayCodes("© , 11:30 - 13:00", 0.9);
      expect(day2.days).toEqual([]);
      expect(day2.issues.some((i) => i.code === "DAY_UNRESOLVED")).toBe(true);
      expect(day2.issues.some((i) => i.code === "DAY_TOKEN_AMBIGUOUS")).toBe(true);

      // 3. "10:30 - 08:30 ©" -> reversed time flagged as INVALID_TIME_RANGE
      const time3 = parseTtuTimeRange("10:30 - 08:30 ©", 0.9);
      expect(time3.startsAt).toBeNull();
      expect(time3.endsAt).toBeNull();
      expect(time3.issues.some((i) => i.code === "INVALID_TIME_RANGE")).toBe(true);

      // 4. "ح ث 08:30 - 10:00" -> exact ح and ث, no خ
      const day4 = parseTtuDayCodes("ح ث 08:30 - 10:00", 0.9);
      expect(day4.days).toEqual(["ح", "ث"]);
      expect(day4.days).not.toContain("خ");
      expect(day4.issues).toHaveLength(0);
    });
  });

  describe("Determinism & Source-Bounded Confidence", () => {
    it("is 100% deterministic (calling twice produces identical output)", () => {
      const row = makeRow({
        index: 0,
        y0: 100,
        y1: 150,
        courseName: "الذكاء الاصطناعي",
        meetingText: "ح ث 10:00 - 11:30",
        roomText: "207 م"
      });
      const geo = makeGeometry([row]);

      const res1 = parseTtuScheduleSemantics(geo);
      const res2 = parseTtuScheduleSemantics(geo);

      expect(JSON.stringify(res1)).toBe(JSON.stringify(res2));
    });

    it("bounds confidence by source segment confidence", () => {
      const lowConf = 0.72;
      const dayResult = parseTtuDayCodes("ح ث", lowConf);
      expect(dayResult.confidence).toBeLessThanOrEqual(lowConf);

      const timeResult = parseTtuTimeRange("10:00 - 11:00", lowConf);
      expect(timeResult.confidence).toBeLessThanOrEqual(lowConf);

      const roomResult = parseTtuRoom("207 م", lowConf);
      expect(roomResult.confidence).toBeLessThanOrEqual(lowConf);
    });
  });

  describe("Adapter: toScheduleExtractionResult", () => {
    it("converts TtuParsedSchedule into valid ScheduleExtractionResult conforming to Zod schema", () => {
      const row = makeRow({
        index: 0,
        y0: 100,
        y1: 150,
        courseName: "تصميم الدوائر المنطقية",
        meetingText: "ح ث 11:30 - 13:00",
        roomText: "DS-ICT 2"
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      const adapted = toScheduleExtractionResult(parsed);

      // Validates against existing domain Zod schema
      expect(() => ScheduleExtractionResultSchema.parse(adapted)).not.toThrow();

      expect(adapted.draft.courses).toHaveLength(1);
      const course = adapted.draft.courses[0];
      expect(course.name).toBe("تصميم الدوائر المنطقية");
      expect(course.sessions).toHaveLength(2);

      // IDs must be valid non-empty strings
      for (const session of course.sessions) {
        expect(session.id).toBeDefined();
        expect(typeof session.id).toBe("string");
        expect(session.id.length).toBeGreaterThan(10);
      }
    });

    it("preserves all diagnostic issues in the adapted draft", () => {
      const row = makeRow({
        index: 0,
        y0: 100,
        y1: 150,
        courseName: "مادة تجريبية",
        meetingText: "ح & 11:00 - 10:00", // ambiguous day & reversed time
        roomText: "" // missing room
      });

      const parsed = parseTtuScheduleSemantics(makeGeometry([row]));
      const adapted = toScheduleExtractionResult(parsed);

      expect(adapted.draft.issues.length).toBeGreaterThanOrEqual(3);
      expect(adapted.draft.issues.some((i) => i.message.includes("وقت") || i.message.includes("توقيت"))).toBe(true);
      expect(adapted.draft.issues.some((i) => i.message.includes("قاعة"))).toBe(true);
    });
  });
});
