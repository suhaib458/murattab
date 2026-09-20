/**
 * TTU Table Header Detector.
 *
 * Identifies table header anchors in the OCR output using band-level evidence.
 *
 * Rules:
 *   1. Multiple column headers must cluster in the same vertical band.
 *   2. Short aliases (e.g. "مادة", "شعبة", "قاعة") cannot independently establish a header.
 *   3. Core evidence requires presence of primary schedule keys (courseName, meeting, room).
 *   4. Normalized text is used solely for comparison; rawText is preserved.
 *   5. All vertical clustering tolerances are derived from median line height (no fixed pixels).
 */

import type { OcrBoundingBox, OcrImageResult, OcrLine, OcrWord } from "@/domain/ocr/types";
import type { TtuColumnKey, TtuTableParseIssue } from "./types";
import { normalizeForMatching } from "./text-normalization";

export interface HeaderCandidate {
  key: TtuColumnKey;
  rawText: string;
  bbox: OcrBoundingBox;
  confidence: number;
  isShortAlias: boolean;
  isCore: boolean;
}

export interface HeaderDetectionResult {
  headers: HeaderCandidate[];
  headerBand: { y0: number; y1: number } | null;
  issues: TtuTableParseIssue[];
  confidence: number;
}

// ── Header Aliases ─────────────────────────────────────────────────────

interface HeaderPattern {
  key: TtuColumnKey;
  patterns: string[];
  isShort: boolean;
  isCore: boolean;
}

const HEADER_PATTERNS: HeaderPattern[] = [
  // Course Name (Core)
  {
    key: "courseName",
    patterns: [
      "اسم الماده",
      "اسم المساق",
      "الماده الدراسيه",
      "اسم المقرر",
      "الماده",
      "المساق",
      "المقرر",
    ],
    isShort: false,
    isCore: true,
  },
  {
    key: "courseName",
    patterns: ["ماده"],
    isShort: true,
    isCore: true,
  },

  // Meeting / Time (Core)
  {
    key: "meeting",
    patterns: [
      "موعد المحاضره",
      "اوقات المحاضره",
      "وقت المحاضره",
      "مواعيد المحاضره",
      "الموعد",
      "الوقت",
      "المواعيد",
      "الاوقات",
    ],
    isShort: false,
    isCore: true,
  },
  {
    key: "meeting",
    patterns: ["موعد", "وقت"],
    isShort: true,
    isCore: true,
  },

  // Room / Location (Core)
  {
    key: "room",
    patterns: [
      "مكان المحاضره",
      "قاعه المحاضره",
      "القاعه",
      "المكان",
    ],
    isShort: false,
    isCore: true,
  },
  {
    key: "room",
    patterns: ["قاعه"],
    isShort: true,
    isCore: true,
  },

  // Section (Secondary)
  {
    key: "section",
    patterns: [
      "رقم الشعبه",
      "الشعبه الدراسيه",
      "الشعبه",
    ],
    isShort: false,
    isCore: false,
  },
  {
    key: "section",
    patterns: ["شعبه"],
    isShort: true,
    isCore: false,
  },

  // Credit Hours (Secondary)
  {
    key: "creditHours",
    patterns: [
      "عدد الساعات",
      "الساعات المعتمده",
      "ساعات معتمده",
      "س م",
      "الساعات",
      "ساعات",
    ],
    isShort: false,
    isCore: false,
  },
];

/**
 * Union two bounding boxes.
 */
function unionBbox(a: OcrBoundingBox, b: OcrBoundingBox): OcrBoundingBox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Check if a normalized text exactly matches any pattern for a given column key.
 */
function matchHeaderPattern(normalizedText: string): { key: TtuColumnKey; isShort: boolean; isCore: boolean } | null {
  for (const def of HEADER_PATTERNS) {
    for (const pattern of def.patterns) {
      if (normalizedText === pattern) {
        return { key: def.key, isShort: def.isShort, isCore: def.isCore };
      }
    }
  }
  return null;
}

/**
 * Scan lines and word sequences for candidate header anchors.
 */
function scanHeaderCandidates(
  lines: OcrLine[],
  words: OcrWord[],
  medianLineHeight: number
): HeaderCandidate[] {
  const candidates: HeaderCandidate[] = [];

  // 1. Check each line's complete text
  for (const line of lines) {
    const norm = normalizeForMatching(line.text);
    const match = matchHeaderPattern(norm);
    if (match) {
      candidates.push({
        key: match.key,
        rawText: line.text,
        bbox: line.bbox,
        confidence: line.confidence,
        isShortAlias: match.isShort,
        isCore: match.isCore,
      });
      continue;
    }

    // 2. Also check sliding windows of 1-3 adjacent words within the line
    if (line.words.length > 1) {
      for (let i = 0; i < line.words.length; i++) {
        for (let len = 1; len <= Math.min(3, line.words.length - i); len++) {
          const slice = line.words.slice(i, i + len);
          const combinedRaw = slice.map((w) => w.text).join(" ");
          const combinedNorm = normalizeForMatching(combinedRaw);
          const sliceMatch = matchHeaderPattern(combinedNorm);
          if (sliceMatch) {
            let bbox = slice[0].bbox;
            for (let j = 1; j < slice.length; j++) {
              bbox = unionBbox(bbox, slice[j].bbox);
            }
            const avgConf = slice.reduce((acc, w) => acc + w.confidence, 0) / slice.length;
            candidates.push({
              key: sliceMatch.key,
              rawText: combinedRaw,
              bbox,
              confidence: avgConf,
              isShortAlias: sliceMatch.isShort,
              isCore: sliceMatch.isCore,
            });
          }
        }
      }
    }
  }

  // 3. Check standalone words if line structure was fragmented
  if (candidates.length === 0) {
    for (const word of words) {
      const norm = normalizeForMatching(word.text);
      const match = matchHeaderPattern(norm);
      if (match) {
        candidates.push({
          key: match.key,
          rawText: word.text,
          bbox: word.bbox,
          confidence: word.confidence,
          isShortAlias: match.isShort,
          isCore: match.isCore,
        });
      }
    }
  }

  // Deduplicate overlapping candidates for the same column key using scale-invariant tolerance
  const dedupeTolerance = Math.max(1, medianLineHeight * 2.0);
  const uniqueCandidates: HeaderCandidate[] = [];
  for (const cand of candidates) {
    const existing = uniqueCandidates.find(
      (c) =>
        c.key === cand.key &&
        Math.abs((c.bbox.x0 + c.bbox.x1) / 2 - (cand.bbox.x0 + cand.bbox.x1) / 2) < dedupeTolerance
    );
    if (!existing) {
      uniqueCandidates.push(cand);
    } else if (cand.rawText.length > existing.rawText.length) {
      // Prefer longer, more specific match (e.g. "اسم المادة" over "المادة")
      const idx = uniqueCandidates.indexOf(existing);
      uniqueCandidates[idx] = cand;
    }
  }

  return uniqueCandidates;
}

/**
 * Detect table header row and columns using vertical band clustering.
 *
 * @param ocr - Raw OCR result from Phase 1.
 * @param medianLineHeight - Scale-invariant median line height.
 */
export function detectHeaders(ocr: OcrImageResult, medianLineHeight: number): HeaderDetectionResult {
  const issues: TtuTableParseIssue[] = [];

  const rawCandidates = scanHeaderCandidates(ocr.lines, ocr.words, medianLineHeight);

  if (rawCandidates.length === 0) {
    issues.push({
      code: "HEADER_NOT_FOUND",
      message: "لم يتم العثور على أي من عناوين أعمدة جدول الجامعة (اسم المادة، الموعد، القاعة).",
      severity: "error",
    });
    return { headers: [], headerBand: null, issues, confidence: 0 };
  }

  // Vertical clustering: group candidates whose y-centers are close relative to medianLineHeight
  // Tolerance: 1.0 * medianLineHeight
  const bandTolerance = Math.max(1, medianLineHeight * 1.0);

  interface BandGroup {
    candidates: HeaderCandidate[];
    yCenterAvg: number;
    y0: number;
    y1: number;
  }

  const bands: BandGroup[] = [];

  for (const cand of rawCandidates) {
    const yCenter = (cand.bbox.y0 + cand.bbox.y1) / 2;
    let placed = false;

    for (const band of bands) {
      if (Math.abs(band.yCenterAvg - yCenter) <= bandTolerance) {
        band.candidates.push(cand);
        band.y0 = Math.min(band.y0, cand.bbox.y0);
        band.y1 = Math.max(band.y1, cand.bbox.y1);
        band.yCenterAvg = band.candidates.reduce((acc, c) => acc + (c.bbox.y0 + c.bbox.y1) / 2, 0) / band.candidates.length;
        placed = true;
        break;
      }
    }

    if (!placed) {
      bands.push({
        candidates: [cand],
        yCenterAvg: yCenter,
        y0: cand.bbox.y0,
        y1: cand.bbox.y1,
      });
    }
  }

  // Score each band based on band-level evidence:
  // - Distinct column keys
  // - Core column keys (courseName, meeting, room)
  // - Penalty for bands that consist solely of short aliases
  let bestBand: BandGroup | null = null;
  let bestScore = -1;

  for (const band of bands) {
    // Unique keys in this band
    const keys = new Set(band.candidates.map((c) => c.key));
    const coreKeysCount = band.candidates.filter((c) => c.isCore).length;
    const nonShortCount = band.candidates.filter((c) => !c.isShortAlias).length;

    // Refinement 3: A valid header band MUST have multiple recognized candidates
    // and CANNOT be established by an isolated short alias.
    if (keys.size < 2 && nonShortCount === 0) {
      continue;
    }

    let score = keys.size * 2 + coreKeysCount * 3 + nonShortCount * 1;

    if (score > bestScore) {
      bestScore = score;
      bestBand = band;
    }
  }

  if (!bestBand || bestScore < 4) {
    // Header evidence too weak
    issues.push({
      code: "HEADER_NOT_FOUND",
      message: "عناوين الجدول المكتشفة غير كافية لتحديد بنية الجدول بشكل موثوق.",
      severity: "error",
    });
    return { headers: [], headerBand: null, issues, confidence: 0 };
  }

  // Filter candidates to only include the best candidate per unique key in the best band
  const finalHeaders: HeaderCandidate[] = [];
  const seenKeys = new Set<TtuColumnKey>();

  // Sort by specificity (non-short first)
  bestBand.candidates.sort((a, b) => (b.isShortAlias ? -1 : 1));

  for (const cand of bestBand.candidates) {
    if (!seenKeys.has(cand.key)) {
      seenKeys.add(cand.key);
      finalHeaders.push(cand);
    }
  }

  // Check for missing core columns
  const hasCourseName = seenKeys.has("courseName");
  const hasMeeting = seenKeys.has("meeting");
  const hasRoom = seenKeys.has("room");

  let confidence = 0.5;

  if (hasCourseName && hasMeeting && hasRoom) {
    confidence = 0.95;
    if (seenKeys.has("section")) confidence = Math.min(1, confidence + 0.03);
    if (seenKeys.has("creditHours")) confidence = Math.min(1, confidence + 0.02);
  } else if ((hasCourseName && hasMeeting) || (hasCourseName && hasRoom) || (hasMeeting && hasRoom)) {
    confidence = 0.75;
    issues.push({
      code: "HEADER_PARTIAL",
      message: "تم اكتشاف جزء من أعمدة الجدول فقط (غياب أحد الأعمدة الأساسية: اسم المادة أو الموعد أو القاعة).",
      severity: "warning",
    });
  } else {
    confidence = 0.4;
    issues.push({
      code: "HEADER_PARTIAL",
      message: "أعمدة الجدول المكتشفة ناقصة وقد تؤثر على دقة استخراج الجدول.",
      severity: "warning",
    });
  }

  return {
    headers: finalHeaders,
    headerBand: { y0: bestBand.y0, y1: bestBand.y1 },
    issues,
    confidence,
  };
}
