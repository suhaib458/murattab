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

/**
 * Parses day codes from a meeting segment text.
 *
 * @param segmentText - Raw text of the meeting segment (e.g. "ح ث 11:30 - 13:00")
 * @param sourceConfidence - Bounding confidence from the geometry segment (0–1)
 * @param courseName - Optional course name for issue diagnostic reporting
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

  // Remove time range pattern (e.g. "11:30 - 13:00", "08:30-10:00", including Arabic-Indic digits)
  // to isolate day candidate tokens.
  const timePattern = /[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}\s*[-–—]\s*[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/g;
  const nonTimeText = clean.replace(timePattern, " ").trim();

  // Split non-time text into tokens
  const tokens = nonTimeText.split(/\s+/).filter(Boolean);

  const foundDays: DayCode[] = [];
  const seenDays = new Set<DayCode>();
  let hasAmbiguousToken = false;

  for (const token of tokens) {
    // Strip common punctuation or bidi characters
    const stripped = token.replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");
    if (!stripped) continue;

    // Check if token matches standard Arabic day names
    if (stripped === "السبت" || stripped === "سبت") {
      if (!seenDays.has("س")) { seenDays.add("س"); foundDays.push("س"); }
      continue;
    }
    if (stripped === "الأحد" || stripped === "الاحد" || stripped === "أحد" || stripped === "احد") {
      if (!seenDays.has("ح")) { seenDays.add("ح"); foundDays.push("ح"); }
      continue;
    }
    if (stripped === "الاثنين" || stripped === "الإثنين" || stripped === "اثنين" || stripped === "إثنين") {
      if (!seenDays.has("ن")) { seenDays.add("ن"); foundDays.push("ن"); }
      continue;
    }
    if (stripped === "الثلاثاء" || stripped === "ثلاثاء") {
      if (!seenDays.has("ث")) { seenDays.add("ث"); foundDays.push("ث"); }
      continue;
    }
    if (stripped === "الأربعاء" || stripped === "الاربعاء" || stripped === "أربعاء" || stripped === "اربعاء") {
      if (!seenDays.has("ر")) { seenDays.add("ر"); foundDays.push("ر"); }
      continue;
    }
    if (stripped === "الخميس" || stripped === "خميس") {
      if (!seenDays.has("خ")) { seenDays.add("خ"); foundDays.push("خ"); }
      continue;
    }

    // Inspect individual characters in the token
    const chars = [...stripped];
    let matchedCharInToken = false;

    for (const char of chars) {
      if (TTU_DAY_CODES.includes(char as DayCode)) {
        const code = char as DayCode;
        if (!seenDays.has(code)) {
          seenDays.add(code);
          foundDays.push(code);
        }
        matchedCharInToken = true;
      }
    }

    // If token contained non-day characters or corrupted OCR symbols (e.g. "&", "©", ",", "@")
    const nonDayChars = chars.filter((c) => !TTU_DAY_CODES.includes(c as DayCode) && !/[\s,،\-–—]/.test(c));
    if (nonDayChars.length > 0) {
      hasAmbiguousToken = true;
      issues.push({
        code: "DAY_TOKEN_AMBIGUOUS",
        message: `رمز اليوم "${token}" غير معروف أو غير مقروء بدقة${courseName ? ` لمادة "${courseName}"` : ""}.`,
        severity: "warning",
        courseName
      });
    } else if (!matchedCharInToken && !/^[,،\-–—]+$/.test(stripped)) {
      hasAmbiguousToken = true;
      issues.push({
        code: "DAY_TOKEN_AMBIGUOUS",
        message: `رمز اليوم "${token}" غير معروف أو غير مقروء بدقة${courseName ? ` لمادة "${courseName}"` : ""}.`,
        severity: "warning",
        courseName
      });
    }
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

  // Confidence is bounded by the source segment geometry confidence
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
