/**
 * Murattab TTU Schedule Session Classifier.
 *
 * Deterministically classifies session kind as "lecture", "lab", or "unspecified".
 *
 * Rules:
 * - LAB:
 *   - Explicit Arabic text containing "مختبر"
 *   - Verified plain ICT lab identity (e.g. "ICT - 4", "ICT 4") matching TTU lab convention
 * - LECTURE:
 *   - Verified normal hall expansion (e.g. "207 م" -> "مجمع القاعات – قاعة 207")
 *   - Explicit "قاعة" text where no lab evidence exists
 * - UNSPECIFIED:
 *   - "DS-ICT X" (computerized teaching rooms without explicit lab evidence)
 *   - Any room with insufficient evidence
 *
 * Never uses credit hours to infer session kind.
 */

import type { TtuSemanticIssue } from "./types";

export interface SessionClassificationResult {
  kind: "lecture" | "lab" | "unspecified";
  issues: TtuSemanticIssue[];
}

/**
 * Checks if text matches verified plain ICT computer lab pattern.
 * Explicitly EXCLUDES "DS-ICT" (which are computerized teaching rooms, not necessarily labs).
 */
function isPlainIctLab(text: string): boolean {
  // If it starts with or contains DS-ICT, it is not a plain ICT lab
  if (/DS-ICT/i.test(text)) {
    return false;
  }
  // Matches "ICT - 4", "ICT 4", "ICT-4"
  return /(?:^|\s)ICT(?:\s*-\s*\d+|\s+\d+)/i.test(text);
}

/**
 * Classifies a class session based on deterministic room evidence.
 *
 * @param roomRaw - Raw room string
 * @param roomExpanded - Expanded room label (if any)
 * @param courseName - Optional course name for diagnostics
 */
export function classifySessionKind(
  roomRaw: string,
  roomExpanded?: string,
  courseName?: string
): SessionClassificationResult {
  const issues: TtuSemanticIssue[] = [];
  const rawClean = roomRaw.trim();
  const expandedClean = (roomExpanded ?? "").trim();
  const combined = `${rawClean} ${expandedClean}`;

  // 1. Check for explicit lab indicators
  if (combined.includes("مختبر") || isPlainIctLab(rawClean) || isPlainIctLab(expandedClean)) {
    return { kind: "lab", issues };
  }

  // 2. Check for lecture hall indicators (e.g. "مجمع القاعات", "قاعة")
  // Note: Must NOT be DS-ICT
  if (!/DS-ICT/i.test(combined)) {
    if (combined.includes("مجمع القاعات") || combined.includes("قاعة")) {
      return { kind: "lecture", issues };
    }
  }

  // 3. Fallback: Unspecified
  issues.push({
    code: "SESSION_KIND_UNSPECIFIED",
    message: `نوع المحاضرة (نظري/عملي) غير محدد بدقة للقاعة "${rawClean || "غير محددة"}"${courseName ? ` لمادة "${courseName}"` : ""}.`,
    severity: "info",
    courseName
  });

  return { kind: "unspecified", issues };
}
