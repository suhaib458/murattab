/**
 * TTU Table Cell Builder.
 *
 * Constructs TtuTableCell and TtuCellSegment objects using WORD GEOMETRY
 * as the source of truth.
 *
 * Design constraints:
 *   - Words are assigned to columns based on horizontal center.
 *   - Lines that span multiple columns are split — a full OCR line never leaks
 *     across courseName, meeting, and room.
 *   - Stable word order is preserved for mixed tokens (e.g. ICT - 4, DS-ICT 3, 10:00 - 11:00).
 *   - Multiple vertical segments per cell are ordered top-to-bottom.
 *   - rawText joins segments with `\n`.
 */

import type { OcrBoundingBox, OcrImageResult, OcrLine, OcrWord } from "@/domain/ocr/types";
import type {
  TtuCellSegment,
  TtuTableCell,
  TtuColumnKey,
  TtuTableColumn,
  TtuTableParseIssue,
} from "./types";
import type { RowBand } from "./row-detector";

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

interface AssignedWord {
  word: OcrWord;
  rowIndex: number;
  colKey: TtuColumnKey;
  lineIndex: number;
  wordIndexInLine: number;
}

/**
 * Build all cells for detected rows and columns.
 *
 * @param ocr - Phase 1 OCR image result.
 * @param columns - Detected columns.
 * @param rowBands - Detected row bands.
 * @param medianLineHeight - Scale-invariant median line height.
 */
export function buildRowCells(
  ocr: OcrImageResult,
  columns: TtuTableColumn[],
  rowBands: RowBand[],
  medianLineHeight: number
): {
  rowCells: Map<number, Partial<Record<TtuColumnKey, TtuTableCell>>>;
  issues: TtuTableParseIssue[];
} {
  const issues: TtuTableParseIssue[] = [];
  const assignedWords: AssignedWord[] = [];

  // Create lookup for word index in lines to preserve logical reading order
  const wordMeta = new Map<OcrWord, { lineIndex: number; wordIndexInLine: number }>();
  ocr.lines.forEach((line, lIdx) => {
    line.words.forEach((word, wIdx) => {
      wordMeta.set(word, { lineIndex: lIdx, wordIndexInLine: wIdx });
    });
  });

  // 1. Assign each body word to a row and column
  for (const word of ocr.words) {
    const yCenter = (word.bbox.y0 + word.bbox.y1) / 2;

    // Find row band
    const row = rowBands.find((r) => yCenter >= r.yTop && yCenter < r.yBottom);
    if (!row) continue; // Outside table body (header or footer)

    // Find column
    const xCenter = (word.bbox.x0 + word.bbox.x1) / 2;
    const col = columns.find((c) => xCenter >= c.xStart && xCenter < c.xEnd);
    if (!col) continue;

    // Check for boundary ambiguity (within 5% of column boundary)
    const colWidth = col.xEnd - col.xStart;
    const distToLeft = xCenter - col.xStart;
    const distToRight = col.xEnd - xCenter;
    if (distToLeft < colWidth * 0.05 || distToRight < colWidth * 0.05) {
      issues.push({
        code: "CELL_ASSIGNMENT_AMBIGUOUS",
        message: `الكلمة «${word.text}» قريبة جداً من الحد الفاصل للعمود ${col.key}.`,
        severity: "warning",
        rowIndex: row.index,
        column: col.key,
      });
    }

    const meta = wordMeta.get(word) ?? { lineIndex: 0, wordIndexInLine: 0 };
    assignedWords.push({
      word,
      rowIndex: row.index,
      colKey: col.key,
      lineIndex: meta.lineIndex,
      wordIndexInLine: meta.wordIndexInLine,
    });
  }

  // 2. Group assigned words by (row, column)
  const cellWordsMap = new Map<string, AssignedWord[]>();
  for (const aw of assignedWords) {
    const key = `${aw.rowIndex}:${aw.colKey}`;
    const list = cellWordsMap.get(key) ?? [];
    list.push(aw);
    cellWordsMap.set(key, list);
  }

  // 3. Construct TtuTableCell for each (row, column)
  const rowCells = new Map<number, Partial<Record<TtuColumnKey, TtuTableCell>>>();

  for (const row of rowBands) {
    const cellsForThisRow: Partial<Record<TtuColumnKey, TtuTableCell>> = {};

    for (const col of columns) {
      const key = `${row.index}:${col.key}`;
      const wordsForCell = cellWordsMap.get(key) ?? [];

      if (wordsForCell.length === 0) {
        // Empty cell
        cellsForThisRow[col.key] = {
          column: col.key,
          rawText: "",
          segments: [],
          bbox: null,
          confidence: 1.0,
        };
        continue;
      }

      // Group words into vertical line segments
      // Tolerance: words whose vertical overlap is significant belong to the same visual segment
      const segmentTolerance = Math.max(1, medianLineHeight * 0.4);

      interface SegmentGroup {
        words: AssignedWord[];
        y0: number;
        y1: number;
        yCenter: number;
      }

      const segmentGroups: SegmentGroup[] = [];

      // Sort words by Y position first
      const sortedByY = [...wordsForCell].sort((a, b) => a.word.bbox.y0 - b.word.bbox.y0);

      for (const aw of sortedByY) {
        const yCenter = (aw.word.bbox.y0 + aw.word.bbox.y1) / 2;
        let matchedGroup: SegmentGroup | null = null;

        for (const grp of segmentGroups) {
          if (Math.abs(grp.yCenter - yCenter) <= segmentTolerance) {
            matchedGroup = grp;
            break;
          }
        }

        if (matchedGroup) {
          matchedGroup.words.push(aw);
          matchedGroup.y0 = Math.min(matchedGroup.y0, aw.word.bbox.y0);
          matchedGroup.y1 = Math.max(matchedGroup.y1, aw.word.bbox.y1);
          matchedGroup.yCenter = (matchedGroup.y0 + matchedGroup.y1) / 2;
        } else {
          segmentGroups.push({
            words: [aw],
            y0: aw.word.bbox.y0,
            y1: aw.word.bbox.y1,
            yCenter,
          });
        }
      }

      // Order segments strictly from top to bottom (y0 ascending)
      segmentGroups.sort((a, b) => a.y0 - b.y0);

      const segments: TtuCellSegment[] = [];

      for (const grp of segmentGroups) {
        // Refinement 1: Word geometry is the source of truth
        // Reconstruct words preserving their logical line order if they share a line,
        // or sort by natural reading order.
        const sortedWords = [...grp.words].sort((a, b) => {
          if (a.lineIndex === b.lineIndex) {
            return a.wordIndexInLine - b.wordIndexInLine;
          }
          return a.word.bbox.x0 - b.word.bbox.x0;
        });

        const segmentText = sortedWords.map((sw) => sw.word.text).join(" ");
        let segmentBbox = sortedWords[0].word.bbox;
        for (let i = 1; i < sortedWords.length; i++) {
          segmentBbox = unionBbox(segmentBbox, sortedWords[i].word.bbox);
        }

        const avgConf =
          sortedWords.reduce((sum, sw) => sum + sw.word.confidence, 0) / sortedWords.length;

        segments.push({
          text: segmentText,
          bbox: segmentBbox,
          confidence: avgConf,
        });
      }

      // Assemble rawText from segments joined by newline
      const rawText = segments.map((s) => s.text).join("\n");

      // Cell bbox is union of all segment bboxes
      let cellBbox: OcrBoundingBox | null = null;
      if (segments.length > 0) {
        cellBbox = segments[0].bbox;
        for (let i = 1; i < segments.length; i++) {
          cellBbox = unionBbox(cellBbox, segments[i].bbox);
        }
      }

      const cellConfidence =
        segments.length > 0
          ? segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length
          : 1.0;

      cellsForThisRow[col.key] = {
        column: col.key,
        rawText,
        segments,
        bbox: cellBbox,
        confidence: cellConfidence,
      };
    }

    rowCells.set(row.index, cellsForThisRow);
  }

  return { rowCells, issues };
}
