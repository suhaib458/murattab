/**
 * TTU Table Row Detector.
 *
 * Partitions the table body vertically into logical course rows using:
 *   1. Course-name visual lines as the primary textual anchor.
 *   2. Corroborated section + credit-hours metadata as row-boundary evidence.
 *   3. Secondary / fallback vertical gap clustering across columns.
 *   4. Conservative bottom cutoff: Excludes footer text, signatures, or print metadata.
 *
 * Multi-line sessions (e.g. Lecture + Lab for the same course) remain in ONE row.
 */

import type { OcrBoundingBox, OcrWord } from "@/domain/ocr/types";
import type { TtuTableColumn } from "./types";

export interface RowBand {
  index: number;
  yTop: number;
  yBottom: number;
}

export interface RowDetectionResult {
  rowBands: RowBand[];
  tableBottom: number;
  footerDetected: boolean;
}

/**
 * Union of bounding boxes.
 */
function unionBboxes(boxes: OcrBoundingBox[]): OcrBoundingBox {
  if (boxes.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  let x0 = boxes[0].x0;
  let y0 = boxes[0].y0;
  let x1 = boxes[0].x1;
  let y1 = boxes[0].y1;
  for (let i = 1; i < boxes.length; i++) {
    x0 = Math.min(x0, boxes[i].x0);
    y0 = Math.min(y0, boxes[i].y0);
    x1 = Math.max(x1, boxes[i].x1);
    y1 = Math.max(y1, boxes[i].y1);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Identify logical course row bands below the header.
 *
 * @param bodyWords - All OCR words located below the header band.
 * @param columns - Detected table columns.
 * @param headerBottom - Y-bottom coordinate of the header band.
 * @param medianLineHeight - Scale-invariant median line height.
 */
export function detectRowBands(
  bodyWords: OcrWord[],
  columns: TtuTableColumn[],
  headerBottom: number,
  medianLineHeight: number
): RowDetectionResult {
  if (bodyWords.length === 0) {
    return { rowBands: [], tableBottom: headerBottom, footerDetected: false };
  }

  const courseCol = columns.find((c) => c.key === "courseName");

  // Step 1: Detect course name anchors if courseName column exists
  interface CourseAnchor {
    words: OcrWord[];
    bbox: OcrBoundingBox;
    yCenter: number;
  }

  const courseAnchors: CourseAnchor[] = [];

  if (courseCol) {
    // Collect words strictly inside the courseName column.
    //
    // IMPORTANT: course titles may span multiple visual lines. Grouping those
    // lines by vertical gap alone is unsafe because the next course can start
    // only a few pixels below the previous title. To prevent adjacent courses
    // from collapsing into one row, we also derive row-boundary evidence from
    // the single-value metadata columns (section + credit hours).
    const courseWords = bodyWords
      .filter((w) => {
        const xCenter = (w.bbox.x0 + w.bbox.x1) / 2;
        return xCenter >= courseCol.xStart && xCenter <= courseCol.xEnd;
      })
      .sort((a, b) => {
        const ay = (a.bbox.y0 + a.bbox.y1) / 2;
        const by = (b.bbox.y0 + b.bbox.y1) / 2;
        return ay - by;
      });

    interface CourseLine {
      words: OcrWord[];
      bbox: OcrBoundingBox;
      yCenter: number;
    }

    // First build visual text lines in the course-name column. This keeps words
    // on the same printed line together without deciding course ownership yet.
    const courseLines: CourseLine[] = [];
    const sameLineTol = Math.max(2, medianLineHeight * 0.45);

    for (const w of courseWords) {
      const wordCenter = (w.bbox.y0 + w.bbox.y1) / 2;
      const last = courseLines[courseLines.length - 1];

      if (last && Math.abs(wordCenter - last.yCenter) <= sameLineTol) {
        last.words.push(w);
        last.bbox = unionBboxes(last.words.map((cw) => cw.bbox));
        last.yCenter = (last.bbox.y0 + last.bbox.y1) / 2;
      } else {
        courseLines.push({
          words: [w],
          bbox: { ...w.bbox },
          yCenter: wordCenter,
        });
      }
    }

    // Derive conservative row-center cues from columns that should contain a
    // single value per course. When both columns agree on a vertical cluster,
    // the midpoint between two adjacent clusters is a strong row boundary.
    const metadataKeys = ["section", "creditHours"] as const;
    const metadataPoints: Array<{ y: number; key: (typeof metadataKeys)[number] }> = [];

    for (const key of metadataKeys) {
      const col = columns.find((c) => c.key === key);
      if (!col) continue;

      for (const w of bodyWords) {
        const xCenter = (w.bbox.x0 + w.bbox.x1) / 2;
        if (xCenter < col.xStart || xCenter > col.xEnd) continue;
        if (!w.text.trim()) continue;

        metadataPoints.push({
          y: (w.bbox.y0 + w.bbox.y1) / 2,
          key,
        });
      }
    }

    metadataPoints.sort((a, b) => a.y - b.y);

    const metadataClusterTol = Math.max(2, medianLineHeight * 0.7);
    const metadataClusters: Array<{
      ys: number[];
      keys: Set<(typeof metadataKeys)[number]>;
    }> = [];

    for (const point of metadataPoints) {
      const last = metadataClusters[metadataClusters.length - 1];
      const lastCenter =
        last && last.ys.length > 0
          ? last.ys.reduce((sum, y) => sum + y, 0) / last.ys.length
          : Number.NaN;

      if (last && Math.abs(point.y - lastCenter) <= metadataClusterTol) {
        last.ys.push(point.y);
        last.keys.add(point.key);
      } else {
        metadataClusters.push({
          ys: [point.y],
          keys: new Set([point.key]),
        });
      }
    }

    // Prefer clusters corroborated by BOTH metadata columns. A single stray
    // OCR token in one metadata column must not manufacture a row boundary.
    const corroboratedCenters = metadataClusters
      .filter((cluster) => cluster.keys.size >= 2)
      .map((cluster) => cluster.ys.reduce((sum, y) => sum + y, 0) / cluster.ys.length)
      .sort((a, b) => a - b);

    const metadataBoundaries: number[] = [];
    for (let i = 0; i < corroboratedCenters.length - 1; i++) {
      metadataBoundaries.push((corroboratedCenters[i] + corroboratedCenters[i + 1]) / 2);
    }

    const metadataZoneFor = (y: number): number => {
      let zone = 0;
      for (const boundary of metadataBoundaries) {
        if (y > boundary) zone++;
        else break;
      }
      return zone;
    };

    // Now group adjacent VISUAL LINES into course-title anchors. Vertical gap
    // remains the fallback, but a corroborated metadata boundary always wins.
    const lineGapTol = Math.max(1, medianLineHeight * 0.8);
    let currentLines: CourseLine[] = [];

    const flushCurrentLines = () => {
      if (currentLines.length === 0) return;
      const words = currentLines.flatMap((line) => line.words);
      const bbox = unionBboxes(words.map((cw) => cw.bbox));
      courseAnchors.push({
        words,
        bbox,
        yCenter: (bbox.y0 + bbox.y1) / 2,
      });
      currentLines = [];
    };

    for (const line of courseLines) {
      if (currentLines.length === 0) {
        currentLines.push(line);
        continue;
      }

      const prevLine = currentLines[currentLines.length - 1];
      const currentBottom = Math.max(...currentLines.map((l) => l.bbox.y1));
      const gap = line.bbox.y0 - currentBottom;

      const crossedMetadataBoundary =
        metadataBoundaries.length > 0 &&
        metadataZoneFor(prevLine.yCenter) !== metadataZoneFor(line.yCenter);

      if (!crossedMetadataBoundary && gap <= lineGapTol) {
        currentLines.push(line);
      } else {
        flushCurrentLines();
        currentLines.push(line);
      }
    }

    flushCurrentLines();
  }

  // Filter out any anchor candidate that belongs to the footer (print metadata, page numbers, notes)
  let footerDetected = false;
  const validCourseAnchors: CourseAnchor[] = [];

  for (const anchor of courseAnchors) {
    const text = anchor.words.map((w) => w.text).join(" ");
    const norm = text.replace(/[\u200E\u200F\u0640]/g, "").toLowerCase();

    const isFooterKeyword =
      norm.includes("صفحه") ||
      norm.includes("صفحة") ||
      norm.includes("تاريخ") ||
      norm.includes("طباعه") ||
      norm.includes("طباعة") ||
      norm.includes("ملاحظه") ||
      norm.includes("ملاحظة") ||
      norm.includes("عميد") ||
      norm.includes("page") ||
      norm.includes("date");

    if (validCourseAnchors.length > 0) {
      const prev = validCourseAnchors[validCourseAnchors.length - 1];
      const gap = anchor.bbox.y0 - prev.bbox.y1;
      const isUnusuallyLargeGap = gap > medianLineHeight * 10.0;

      if (isFooterKeyword || isUnusuallyLargeGap) {
        footerDetected = true;
        break; // Stop taking anchors; remaining content is footer
      }
    } else if (isFooterKeyword) {
      footerDetected = true;
      continue;
    }

    validCourseAnchors.push(anchor);
  }

  // Step 2: Build row bands based on valid course anchors or vertical gap clustering
  const rowBands: RowBand[] = [];
  let tableBottom = headerBottom;

  if (validCourseAnchors.length > 0) {
    // Compute median height between course anchor tops
    const anchorGaps: number[] = [];
    for (let i = 0; i < validCourseAnchors.length - 1; i++) {
      anchorGaps.push(validCourseAnchors[i + 1].bbox.y0 - validCourseAnchors[i].bbox.y0);
    }
    const medianAnchorGap =
      anchorGaps.length > 0
        ? [...anchorGaps].sort((a, b) => a - b)[Math.floor(anchorGaps.length / 2)]
        : medianLineHeight * 3.0;

    for (let i = 0; i < validCourseAnchors.length; i++) {
      const cur = validCourseAnchors[i];
      const next = i < validCourseAnchors.length - 1 ? validCourseAnchors[i + 1] : null;

      // Row top: halfway from previous anchor bottom or header bottom
      const yTop =
        i === 0
          ? headerBottom
          : Math.round((validCourseAnchors[i - 1].bbox.y1 + cur.bbox.y0) / 2);

      // Row bottom: halfway to next anchor top, or for the last row, bounded by its content
      let yBottom: number;

      if (next) {
        yBottom = Math.round((cur.bbox.y1 + next.bbox.y0) / 2);
      } else {
        // Last row: collect body words whose vertical center is below yTop
        const lastRowWords = bodyWords.filter(
          (w) => (w.bbox.y0 + w.bbox.y1) / 2 >= yTop
        );

        // Group last row words into horizontal lines
        const lineTol = Math.max(1, medianLineHeight * 0.8);
        const sortedY = [...lastRowWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);

        interface WordLine {
          words: OcrWord[];
          y0: number;
          y1: number;
        }

        const lines: WordLine[] = [];
        for (const w of sortedY) {
          const matched = lines.find(
            (l) => Math.abs(l.y0 - w.bbox.y0) <= lineTol || Math.abs(l.y1 - w.bbox.y1) <= lineTol
          );
          if (matched) {
            matched.words.push(w);
            matched.y0 = Math.min(matched.y0, w.bbox.y0);
            matched.y1 = Math.max(matched.y1, w.bbox.y1);
          } else {
            lines.push({ words: [w], y0: w.bbox.y0, y1: w.bbox.y1 });
          }
        }

        lines.sort((a, b) => a.y0 - b.y0);

        let lastValidY1 = cur.bbox.y1;
        const maxSessionGap = medianLineHeight * 2.5;

        for (const line of lines) {
          const lineText = line.words.map((w) => w.text).join(" ");
          const norm = lineText.replace(/[\u200E\u200F\u0640]/g, "").toLowerCase();

          const isFooter =
            norm.includes("صفحه") ||
            norm.includes("صفحة") ||
            norm.includes("تاريخ") ||
            norm.includes("طباعه") ||
            norm.includes("طباعة") ||
            norm.includes("ملاحظه") ||
            norm.includes("ملاحظة") ||
            norm.includes("عميد") ||
            norm.includes("page") ||
            norm.includes("date");

          const gap = line.y0 - lastValidY1;

          if (isFooter || gap > maxSessionGap) {
            footerDetected = true;
            break; // Stop including lines — this line and below are footer text
          }

          lastValidY1 = Math.max(lastValidY1, line.y1);
        }

        // Add small margin below the last item (0.4 * medianLineHeight)
        yBottom = Math.round(lastValidY1 + medianLineHeight * 0.4);
      }

      rowBands.push({
        index: i,
        yTop,
        yBottom,
      });

      tableBottom = Math.max(tableBottom, yBottom);
    }
  } else {
    // Fallback: Group by vertical line clusters across all columns
    const sortedWords = [...bodyWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);
    const rowGapTol = Math.max(1, medianLineHeight * 1.5);

    let currentRowWords: OcrWord[] = [];
    let rowIndex = 0;

    for (const w of sortedWords) {
      if (currentRowWords.length === 0) {
        currentRowWords.push(w);
      } else {
        const curBottom = Math.max(...currentRowWords.map((rw) => rw.bbox.y1));
        if (w.bbox.y0 - curBottom <= rowGapTol) {
          currentRowWords.push(w);
        } else {
          const rowBox = unionBboxes(currentRowWords.map((rw) => rw.bbox));
          rowBands.push({
            index: rowIndex++,
            yTop: rowBox.y0 - Math.round(medianLineHeight * 0.2),
            yBottom: rowBox.y1 + Math.round(medianLineHeight * 0.2),
          });
          currentRowWords = [w];
        }
      }
    }

    if (currentRowWords.length > 0) {
      const rowBox = unionBboxes(currentRowWords.map((rw) => rw.bbox));
      rowBands.push({
        index: rowIndex,
        yTop: rowBox.y0 - Math.round(medianLineHeight * 0.2),
        yBottom: rowBox.y1 + Math.round(medianLineHeight * 0.2),
      });
      tableBottom = rowBox.y1;
    }
  }

  return { rowBands, tableBottom, footerDetected };
}
