/**
 * Murattab TTU Schedule Time Parser.
 *
 * Deterministically extracts and validates 24-hour time ranges from meeting segments.
 *
 * Supports:
 * - Variable spacing around dashes (e.g. "08:30 - 10:00", "08:30-10:00", "08:30 -10:00")
 * - Arabic-Indic digit normalization (٠-٩ -> 0-9)
 * - Strict HH:mm validation
 * - Strict endsAt > startsAt check
 *
 * Never auto-swaps reversed times.
 * Never invents default start times or durations.
 */

import type { TtuSemanticIssue } from "./types";

export interface TimeParseResult {
  /** 24-hour start time (HH:mm), or null if invalid/missing. */
  startsAt: string | null;
  /** 24-hour end time (HH:mm), or null if invalid/missing. */
  endsAt: string | null;
  /** Time extraction confidence bounded by source segment confidence (0–1). */
  confidence: number;
  /** Diagnostic issues encountered. */
  issues: TtuSemanticIssue[];
}

const ARABIC_INDIC_DIGITS: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9"
};

/**
 * Normalizes Arabic-Indic digits to standard ASCII digits.
 */
export function normalizeArabicDigits(text: string): { normalized: string; hadArabicDigits: boolean } {
  let hadArabicDigits = false;
  const normalized = text.replace(/[\u0660-\u0669]/g, (digit) => {
    hadArabicDigits = true;
    return ARABIC_INDIC_DIGITS[digit] ?? digit;
  });
  return { normalized, hadArabicDigits };
}

/**
 * Validates whether a time string is a valid 24-hour HH:mm time.
 */
function parseValidTime(rawTime: string): { formatted: string; totalMinutes: number } | null {
  const match = rawTime.trim().match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (isNaN(hours) || isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return {
    formatted: `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`,
    totalMinutes: hours * 60 + minutes
  };
}

/**
 * Parses time range from a meeting segment text.
 *
 * @param segmentText - Raw text of the meeting segment
 * @param sourceConfidence - Bounding confidence from geometry (0–1)
 * @param courseName - Optional course name for issue diagnostic reporting
 */
export function parseTtuTimeRange(
  segmentText: string,
  sourceConfidence = 1.0,
  courseName?: string
): TimeParseResult {
  const issues: TtuSemanticIssue[] = [];
  const { normalized, hadArabicDigits } = normalizeArabicDigits(segmentText);

  // Match time range pattern: (H:m) - (H:m)
  const rangeMatch = normalized.match(
    /(\d{1,2}\s*:\s*\d{1,2})\s*[-–—]\s*(\d{1,2}\s*:\s*\d{1,2})/
  );

  if (!rangeMatch) {
    issues.push({
      code: "TIME_RANGE_MISSING",
      message: `لم يتم العثور على نطاق توقيت واضح في النص "${segmentText}"${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "error",
      courseName
    });
    return {
      startsAt: null,
      endsAt: null,
      confidence: 0,
      issues
    };
  }

  const startParsed = parseValidTime(rangeMatch[1]);
  const endParsed = parseValidTime(rangeMatch[2]);

  if (!startParsed || !endParsed) {
    issues.push({
      code: "INVALID_TIME_RANGE",
      message: `توقيت غير صالح في النص "${segmentText}"${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "error",
      courseName
    });
    return {
      startsAt: null,
      endsAt: null,
      confidence: 0,
      issues
    };
  }

  // Strict check: endsAt must be strictly greater than startsAt
  if (endParsed.totalMinutes <= startParsed.totalMinutes) {
    issues.push({
      code: "INVALID_TIME_RANGE",
      message: `وقت النهاية (${endParsed.formatted}) يسبق أو يطابق وقت البداية (${startParsed.formatted}) في النص "${segmentText}"${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "error",
      courseName
    });
    return {
      startsAt: null,
      endsAt: null,
      confidence: 0,
      issues
    };
  }

  // Bounded confidence calculation
  const baseConfidence = hadArabicDigits
    ? Math.min(sourceConfidence, 0.92)
    : Math.min(sourceConfidence, 0.95);

  return {
    startsAt: startParsed.formatted,
    endsAt: endParsed.formatted,
    confidence: baseConfidence,
    issues
  };
}
