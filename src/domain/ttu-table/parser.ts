/**
 * TTU Table Geometry Parser.
 *
 * Orchestrates the full pipeline:
 *   OcrImageResult
 *   → Header Detection (band-level evidence)
 *   → Column Boundaries (header-driven, resolution-independent)
 *   → Row Banding (courseName anchors, multi-session preservation, footer exclusion)
 *   → Cell & Segment Building (word geometry as source of truth)
 *   → Diagnostic Issues & Confidence Scoring
 *   → TtuTableGeometryResult
 */

import type { OcrBoundingBox, OcrImageResult, OcrLine, OcrWord } from "@/domain/ocr/types";
import type {
  TtuTableGeometryResult,
  TtuTableParseIssue,
  TtuTableRow,
  TtuTableCell,
  TtuColumnKey,
} from "./types";
import { detectHeaders } from "./header-detector";
import { detectColumns } from "./column-detector";
import { detectRowBands } from "./row-detector";
import { buildRowCells } from "./cell-builder";

/**
 * Union bounding boxes.
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
 * Compute scale-invariant median line height from OCR items.
 */
function computeMedianLineHeight(
  lines: OcrLine[],
  words: OcrWord[],
  imageHeight: number
): number {
  const lineHeights = lines
    .map((l) => l.bbox.y1 - l.bbox.y0)
    .filter((h) => h > 0);

  if (lineHeights.length > 0) {
    lineHeights.sort((a, b) => a - b);
    return lineHeights[Math.floor(lineHeights.length / 2)];
  }

  const wordHeights = words
    .map((w) => w.bbox.y1 - w.bbox.y0)
    .filter((h) => h > 0);

  if (wordHeights.length > 0) {
    wordHeights.sort((a, b) => a - b);
    return wordHeights[Math.floor(wordHeights.length / 2)];
  }

  return Math.max(1, imageHeight * 0.03);
}

/**
 * Parse a TTU schedule table's geometry from an OCR image result.
 *
 * @param ocr - Phase 1 normalized OCR image result.
 * @returns Complete deterministic geometry result.
 */
export function parseTtuTableGeometry(ocr: OcrImageResult): TtuTableGeometryResult {
  const allIssues: TtuTableParseIssue[] = [];

  // 1. Basic validation
  if (!ocr || !ocr.words || ocr.words.length === 0) {
    allIssues.push({
      code: "IMAGE_TOO_FEW_TOKENS",
      message: "لا توجد كلمات أو نصوص كافية في نتيجة التعرف البصري لتحديد الجدول.",
      severity: "error",
    });
    return { columns: [], rows: [], issues: allIssues, confidence: 0 };
  }

  // 2. Compute scale-invariant vertical baseline
  const medianLineHeight = computeMedianLineHeight(ocr.lines, ocr.words, ocr.height);

  // 3. Header Detection
  const headerResult = detectHeaders(ocr, medianLineHeight);
  allIssues.push(...headerResult.issues);

  if (!headerResult.headerBand || headerResult.headers.length === 0) {
    // Header detection failed completely — adhere to non-guessing policy
    return {
      columns: [],
      rows: [],
      issues: allIssues,
      confidence: 0,
    };
  }

  // 4. Column Detection
  const columns = detectColumns(headerResult.headers, ocr.width);

  // 5. Table Body Filtering
  const headerBottom = headerResult.headerBand.y1;
  const bodyWords = ocr.words.filter(
    (w) => (w.bbox.y0 + w.bbox.y1) / 2 > headerBottom
  );

  // 6. Row Band Detection
  const rowResult = detectRowBands(bodyWords, columns, headerBottom, medianLineHeight);

  if (rowResult.footerDetected) {
    allIssues.push({
      code: "FOOTER_DETECTED",
      message: "تم اكتشاف نصوص في أسفل الصفحة خارج الجدول وتم استبعادها بنجاح.",
      severity: "info",
    });
  }

  if (rowResult.rowBands.length === 0) {
    allIssues.push({
      code: "NO_ROWS_DETECTED",
      message: "تم العثور على عناوين الجدول ولكن لم يتم العثور على صفوف مواد دراسية.",
      severity: "warning",
    });
    return {
      columns,
      rows: [],
      issues: allIssues,
      confidence: headerResult.confidence * 0.5,
    };
  }

  // 7. Cell & Segment Building
  const cellResult = buildRowCells(ocr, columns, rowResult.rowBands, medianLineHeight);
  allIssues.push(...cellResult.issues);

  // 8. Assemble TtuTableRow objects
  const rows: TtuTableRow[] = [];

  for (const band of rowResult.rowBands) {
    const cells = cellResult.rowCells.get(band.index) ?? {};

    // Row bounding box is the union of all populated cell bboxes
    let rowBbox: OcrBoundingBox = {
      x0: 0,
      y0: band.yTop,
      x1: ocr.width,
      y1: band.yBottom,
    };

    const populatedCells = Object.values(cells).filter(
      (c): c is TtuTableCell => Boolean(c && c.bbox)
    );

    if (populatedCells.length > 0 && populatedCells[0].bbox) {
      rowBbox = populatedCells[0].bbox;
      for (let i = 1; i < populatedCells.length; i++) {
        const b = populatedCells[i].bbox;
        if (b) rowBbox = unionBbox(rowBbox, b);
      }
    }

    // Check missing key cells
    if (!cells.courseName || cells.courseName.rawText.trim().length === 0) {
      allIssues.push({
        code: "COURSE_NAME_MISSING",
        message: `اسم المادة مفقود أو فارغ في الصف رقم ${band.index + 1}.`,
        severity: "warning",
        rowIndex: band.index,
        column: "courseName",
      });
    }

    if (!cells.meeting || cells.meeting.rawText.trim().length === 0) {
      allIssues.push({
        code: "MEETING_CELL_EMPTY",
        message: `موعد المحاضرة فارغ في الصف رقم ${band.index + 1}.`,
        severity: "warning",
        rowIndex: band.index,
        column: "meeting",
      });
    }

    if (!cells.room || cells.room.rawText.trim().length === 0) {
      allIssues.push({
        code: "ROOM_CELL_EMPTY",
        message: `قاعة المحاضرة فارغة في الصف رقم ${band.index + 1}.`,
        severity: "warning",
        rowIndex: band.index,
        column: "room",
      });
    }

    // Row confidence: average of cell confidences
    const rowConfidence =
      populatedCells.length > 0
        ? populatedCells.reduce((sum, c) => sum + c.confidence, 0) / populatedCells.length
        : 0.5;

    rows.push({
      index: band.index,
      bbox: rowBbox,
      cells,
      confidence: rowConfidence,
    });
  }

  // 9. Overall confidence calculation
  const avgRowConfidence =
    rows.length > 0
      ? rows.reduce((sum, r) => sum + r.confidence, 0) / rows.length
      : 0;

  // Penalize for critical issues
  const errorCount = allIssues.filter((i) => i.severity === "error").length;
  const warningCount = allIssues.filter((i) => i.severity === "warning").length;

  let overallConfidence = headerResult.confidence * 0.4 + avgRowConfidence * 0.6;
  overallConfidence = Math.max(0, overallConfidence - errorCount * 0.4 - warningCount * 0.05);

  return {
    columns,
    rows,
    issues: allIssues,
    confidence: Number(overallConfidence.toFixed(3)),
  };
}
