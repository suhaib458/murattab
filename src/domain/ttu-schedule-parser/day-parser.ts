/**
 * Murattab TTU Schedule Day Parser.
 *
 * Deterministically parses TTU day codes from meeting segment text.
 * Strictly adheres to canonical TTU day letters:
 * س (Saturday), ح (Sunday), ن (Monday), ث (Tuesday), ر (Wednesday), خ (Thursday).
 *
 * Never guesses unobserved days.
 * Corrupted or unsupported symbols are treated as ambiguous/unresolved.
 */

import type { DayCode } from "@/domain/models";
import type { TtuSemanticIssue } from "./types";

export const TTU_DAY_CODES: readonly DayCode[] = ["س", "ح", "ن", "ث", "ر", "خ"];

export interface DayParseResult {
  /** Ordered list of canonical TTU day codes extracted. */
  days: DayCode[];
  /** Day extraction confidence bounded by source segment confidence (0–1). */
  confidence: number;
  /** Issues encountered during day parsing. */
  issues: TtuSemanticIssue[];
}

const FULL_DAY_NAMES: Readonly<Record<string, DayCode>> = {
  السبت: "س",
  سبت: "س",
  الأحد: "ح",
  الاحد: "ح",
  أحد: "ح",
  احد: "ح",
  الاثنين: "ن",
  الإثنين: "ن",
  اثنين: "ن",
  إثنين: "ن",
  الثلاثاء: "ث",
  ثلاثاء: "ث",
  الأربعاء: "ر",
  الاربعاء: "ر",
  أربعاء: "ر",
  اربعاء: "ر",
  الخميس: "خ",
  خميس: "خ",
};

const BENIGN_DAY_DELIMITERS = new Set([
  ",", "،", ";", "؛", "|", "/", "\\", "(", ")", "[", "]", "{", "}"
]);

function cleanDayToken(token: string): string {
  const chars = [...token
    .replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "")
    .trim()];

  while (chars.length > 0 && BENIGN_DAY_DELIMITERS.has(chars[0])) chars.shift();
  while (chars.length > 0 && BENIGN_DAY_DELIMITERS.has(chars[chars.length - 1])) chars.pop();

  return chars.join("").trim();
}

function pushUniqueDay(days: DayCode[], seen: Set<DayCode>, code: DayCode): void {
  if (!seen.has(code)) {
    seen.add(code);
    days.push(code);
  }
}

/**
 * Parses day codes from a meeting segment text.
 *
 * Strict-token invariant:
 * - Full Arabic day names are accepted.
 * - A one-letter token is accepted only when it is exactly a canonical TTU day code.
 * - A compact token such as "حث" or "حثخ" is accepted only when EVERY character
 *   in the token is a canonical TTU day code.
 * - Mixed/corrupted tokens such as "حت", "نار", "abcح", "&", "2" are ambiguous
 *   and contribute ZERO inferred days. This prevents accidental day extraction
 *   from arbitrary Arabic/OCR text.
 */
export function parseTtuDayCodes(
  segmentText: string,
  sourceConfidence = 1.0,
  courseName?: string
): DayParseResult {
  const issues: TtuSemanticIssue[] = [];
  const clean = segmentText.trim();

  if (!clean) {
    issues.push({
      code: "DAY_UNRESOLVED",
      message: `لم يتم العثور على أي رمز ليوم المحاضرة${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "warning",
      courseName
    });
    return { days: [], confidence: 0, issues };
  }

  const timePattern = /[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}\s*[-–—]\s*[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/g;
  const nonTimeText = clean.replace(timePattern, " ").trim();
  const tokens = nonTimeText.split(/\s+/).filter(Boolean);

  const foundDays: DayCode[] = [];
  const seenDays = new Set<DayCode>();
  let hasAmbiguousToken = false;

  for (const rawToken of tokens) {
    const token = cleanDayToken(rawToken);
    if (!token || /^[-–—]+$/.test(token)) continue;

    const namedDay = FULL_DAY_NAMES[token];
    if (namedDay) {
      pushUniqueDay(foundDays, seenDays, namedDay);
      continue;
    }

    const chars = [...token];

    // Compact TTU notation is valid ONLY if the entire token is composed of
    // canonical day letters. Example: "حثخ" => ح، ث، خ.
    const isPureCompactDayToken =
      chars.length > 0 &&
      chars.length <= TTU_DAY_CODES.length &&
      chars.every((char) => TTU_DAY_CODES.includes(char as DayCode));

    if (isPureCompactDayToken) {
      for (const char of chars) {
        pushUniqueDay(foundDays, seenDays, char as DayCode);
      }
      continue;
    }

    hasAmbiguousToken = true;
    issues.push({
      code: "DAY_TOKEN_AMBIGUOUS",
      message: `رمز اليوم "${rawToken}" غير معروف أو غير مقروء بدقة${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "warning",
      courseName
    });
  }

  if (foundDays.length === 0) {
    issues.push({
      code: "DAY_UNRESOLVED",
      message: `لم نتمكن من تحديد يوم المحاضرة بدقة من النص "${segmentText}"${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "warning",
      courseName
    });
    return {
      days: [],
      confidence: 0,
      issues
    };
  }

  let confidence = Math.min(sourceConfidence, 0.95);
  if (hasAmbiguousToken) {
    confidence = Math.min(confidence, 0.70);
  }

  return {
    days: foundDays,
    confidence,
    issues
  };
}
