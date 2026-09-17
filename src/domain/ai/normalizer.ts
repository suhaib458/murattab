import {
  type DayCode,
  type DraftCourse,
  type DraftSession,
  type ExtractionIssue,
  type ScheduleExtractionResult,
  dayCodes
} from "../models";
import { expandRoom, getIctLabLabel, orderedDays } from "../schedule";
import type { RawCourseExtraction, RawExtractionResponse, RawSessionExtraction } from "./extraction-schema";

/**
 * Maps Arabic day names or letters to standard DayCode values.
 * Strictly:
 * الأحد -> ح
 * الاثنين / الإثنين -> ن
 * الثلاثاء -> ث
 * الأربعاء / الاربعاء -> ر
 * الخميس -> خ
 * السبت -> س
 */
const DAY_NAME_MAP: Record<string, DayCode> = {
  "السبت": "س",
  "سبت": "س",
  "س": "س",
  "الأحد": "ح",
  "الاحد": "ح",
  "أحد": "ح",
  "احد": "ح",
  "ح": "ح",
  "الاثنين": "ن",
  "الإثنين": "ن",
  "اثنين": "ن",
  "إثنين": "ن",
  "ن": "ن",
  "الثلاثاء": "ث",
  "ثلاثاء": "ث",
  "ث": "ث",
  "الأربعاء": "ر",
  "الاربعاء": "ر",
  "أربعاء": "ر",
  "اربعاء": "ر",
  "ر": "ر",
  "الخميس": "خ",
  "خميس": "خ",
  "خ": "خ"
};

/**
 * Normalizes day string or token combinations to an ordered list of DayCodes.
 * Does NOT default to Sunday or any other day if unresolved.
 */
export function normalizeDayCodes(raw: string): DayCode[] {
  const clean = raw.trim();
  if (!clean) return [];

  const foundDays = new Set<DayCode>();

  // Split by whitespace, commas, slashes, dashes
  const tokens = clean.split(/[\s,،/\\-]+/).map((t) => t.trim()).filter(Boolean);

  for (const token of tokens) {
    // Strip leading Arabic conjunctions (e.g. "والخميس" -> "الخميس", "والثلاثاء" -> "الثلاثاء")
    const stripped = token.replace(/^[ووفف]/, "");
    if (DAY_NAME_MAP[token]) {
      foundDays.add(DAY_NAME_MAP[token]);
    } else if (DAY_NAME_MAP[stripped]) {
      foundDays.add(DAY_NAME_MAP[stripped]);
    } else {
      // If token is composed only of single-letter day codes (e.g. "حثخ", "نر", "ح ث خ")
      const chars = [...token];
      if (chars.length > 0 && chars.every((c) => dayCodes.includes(c as DayCode))) {
        chars.forEach((c) => foundDays.add(c as DayCode));
      }
    }
  }

  // Return in ordered sequence (Saturday to Thursday)
  return orderedDays.filter((d: DayCode) => foundDays.has(d));
}

/**
 * Normalizes a raw time string into 24-hour "HH:mm".
 *
 * Rules:
 * 1. Unambiguous 24-hour formats (e.g., "08:30", "14:00", "11:00") are preserved.
 * 2. Explicit AM/PM markers in Arabic or English ("8:30 ص", "2:00 م", "8:30 am", "2:00 pm") are converted correctly.
 * 3. Ambiguous 12-hour times without AM/PM markers (e.g. hours 1 to 6 without marker) are NOT guessed and return null.
 * 4. Invalid or unparseable times return null.
 */
export function normalizeTime(raw: string): string | null {
  const clean = raw.trim();
  if (!clean) return null;

  // Check explicit AM/PM markers
  const isPM = /(?:^|\s)(?:pm|مساءً?)(?:\s|$)/i.test(clean) || /(\d)\s*(?:pm|م|مساءً?)$/i.test(clean);
  const isAM = /(?:^|\s)(?:am|صباحا|صباحاً)(?:\s|$)/i.test(clean) || /(\d)\s*(?:am|ص|صباحا|صباحاً)$/i.test(clean);

  const match = clean.match(/(\d{1,2})(?::(\d{1,2}))?/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;

  if (isNaN(hours) || isNaN(minutes) || minutes < 0 || minutes > 59) return null;

  if (isPM) {
    if (hours < 12) hours += 12;
    if (hours > 23) return null;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }

  if (isAM) {
    if (hours === 12) hours = 0;
    if (hours < 0 || hours > 11) return null;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  }

  // Without AM/PM:
  // If hours is between 1 and 6, it is ambiguous (could be morning 02:00 or afternoon 14:00).
  // Per requirement: must NOT silently assume PM.
  if (hours >= 1 && hours <= 6) {
    return null;
  }

  if (hours < 0 || hours > 23) return null;

  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

export function categorizeConfidence(score: number): "high" | "medium" | "low" {
  if (score >= 0.85) return "high";
  if (score >= 0.60) return "medium";
  return "low";
}

/**
 * Converts raw AI extraction into a normalized ScheduleExtractionResult adhering to project contracts.
 * NEVER invents missing course names, days, start times, end times, or room mappings.
 */
export function normalizeExtractionResult(raw: RawExtractionResponse): ScheduleExtractionResult {
  const issues: ExtractionIssue[] = [...raw.issues];
  const confidenceRecord: Record<string, number> = {};
  const courses: DraftCourse[] = [];

  if (raw.courses.length === 0) {
    issues.push({
      field: "schedule",
      message: "لم يتم العثور على أي مواد أو جدول دراسي في هذا الملف.",
      severity: "warning"
    });
  }

  raw.courses.forEach((courseRaw: RawCourseExtraction, cIndex: number) => {
    const courseId = crypto.randomUUID();
    const rawName = courseRaw.courseName.trim();
    // Do NOT invent names such as "مادة غير مسماة 1"
    const courseName = rawName;
    const nameConfidence = rawName ? (courseRaw.nameConfidence ?? 0.9) : 0;
    confidenceRecord[`course_${courseId}_name`] = nameConfidence;

    if (!courseName) {
      issues.push({
        field: `course_${cIndex}_name`,
        message: `اسم المادة رقم #${cIndex + 1} غير مقروء أو مفقود، يرجى إدخاله يدوياً قبل الاعتماد.`,
        severity: "warning"
      });
    } else if (categorizeConfidence(nameConfidence) === "low") {
      issues.push({
        field: `course_${cIndex}_name`,
        message: `اسم المادة "${courseName}" غير مؤكد بنسبة كافية، يرجى التحقق منه.`,
        severity: "warning"
      });
    }

    const courseSessions: DraftSession[] = [];

    courseRaw.sessions.forEach((sessRaw: RawSessionExtraction, sIndex: number) => {
      // Days
      const days = normalizeDayCodes(sessRaw.day);
      const rawDayConfidence = sessRaw.confidence?.day ?? 0.9;
      const dayConfidence = days.length > 0 ? rawDayConfidence : 0;

      if (days.length === 0) {
        issues.push({
          field: `course_${cIndex}_session_${sIndex}_day`,
          message: `لم نتمكن من تحديد يوم المحاضرة لمادة "${courseName || `#${cIndex + 1}`}". يرجى تحديد اليوم.`,
          severity: "warning"
        });
      }

      // Times
      let startsAt = normalizeTime(sessRaw.startsAt);
      let endsAt = normalizeTime(sessRaw.endsAt);

      // Check if startsAt has a range (e.g. "8:00 - 9:30")
      if (!endsAt && sessRaw.startsAt.includes("-")) {
        const parts = sessRaw.startsAt.split("-");
        startsAt = normalizeTime(parts[0]);
        endsAt = normalizeTime(parts[1]);
      }

      const rawTimeConfidence = sessRaw.confidence?.time ?? 0.9;
      const timeConfidence = startsAt && endsAt ? rawTimeConfidence : 0;

      if (!startsAt) {
        // Do NOT invent 08:30
        issues.push({
          field: `course_${cIndex}_session_${sIndex}_startsAt`,
          message: `وقت بدء المحاضرة لمادة "${courseName || `#${cIndex + 1}`}" غير واضح أو مفقود، يرجى إدخاله.`,
          severity: "warning"
        });
      }

      if (!endsAt) {
        // Do NOT invent 60/90 minutes
        issues.push({
          field: `course_${cIndex}_session_${sIndex}_endsAt`,
          message: `وقت انتهاء المحاضرة لمادة "${courseName || `#${cIndex + 1}`}" غير واضح أو مفقود، يرجى إدخاله.`,
          severity: "warning"
        });
      } else if (startsAt && endsAt <= startsAt) {
        issues.push({
          field: `course_${cIndex}_session_${sIndex}_time_order`,
          message: `وقت النهاية (${endsAt}) يسبق أو يطابق وقت البداية (${startsAt}) لمادة "${courseName || `#${cIndex + 1}`}".`,
          severity: "warning"
        });
      }

      // Room: use expandRoom from schedule.ts which expands only verified mappings (هـ/ه, ع, م)
      // Any unverified building code remains raw and unexpanded
      const roomConfidence = sessRaw.confidence?.room ?? (sessRaw.room ? 0.9 : 0);
      const rawRoomText = sessRaw.room.trim();
      const expanded = expandRoom(rawRoomText);
      let roomExpanded: string | undefined = expanded.label !== rawRoomText ? expanded.label : undefined;

      // In the context of a lab session, if room is an ICT lab code, format label as مختبر الحاسوب ICT - 4
      if (!roomExpanded) {
        const ictLabel = getIctLabLabel(rawRoomText, sessRaw.kind);
        if (ictLabel) roomExpanded = ictLabel;
      }

      if (!rawRoomText) {
        issues.push({
          field: `course_${cIndex}_session_${sIndex}_room`,
          message: `لم تظهر قاعة واضحة لمحاضرة "${courseName || `#${cIndex + 1}`}".`,
          severity: "info"
        });
      }

      // If days were parsed, create a DraftSession for each day.
      // If NO day was parsed, create a SINGLE DraftSession with day: null (do NOT invent Sunday!).
      if (days.length > 0) {
        for (const day of days) {
          const sessionId = crypto.randomUUID();
          confidenceRecord[`session_${sessionId}_day`] = dayConfidence;
          confidenceRecord[`session_${sessionId}_time`] = timeConfidence;
          confidenceRecord[`session_${sessionId}_room`] = roomConfidence;

          courseSessions.push({
            id: sessionId,
            courseId,
            day,
            startsAt,
            endsAt,
            roomRaw: rawRoomText,
            roomExpanded,
            kind: sessRaw.kind ?? "unspecified"
          });
        }
      } else {
        const sessionId = crypto.randomUUID();
        confidenceRecord[`session_${sessionId}_day`] = 0;
        confidenceRecord[`session_${sessionId}_time`] = timeConfidence;
        confidenceRecord[`session_${sessionId}_room`] = roomConfidence;

        courseSessions.push({
          id: sessionId,
          courseId,
          day: null, // Unresolved!
          startsAt,
          endsAt,
          roomRaw: rawRoomText,
          roomExpanded,
          kind: sessRaw.kind ?? "unspecified"
        });
      }
    });

    courses.push({
      name: courseName,
      sessions: courseSessions
    });
  });

  return {
    draft: {
      courses,
      issues
    },
    confidence: confidenceRecord
  };
}
