/**
 * TTU Column Detector.
 *
 * Derives horizontal column boundaries dynamically from header anchors.
 *
 * Design principles:
 *   - No hardcoded pixel coordinates or resolution assumptions.
 *   - Physical X-axis sorting: columns are ordered left-to-right (x0 ascending).
 *   - Naturally supports both RTL Arabic layouts and LTR layouts.
 *   - Boundary between adjacent columns is the midpoint between their centers.
 *   - Outermost columns span to the table / image edges.
 */

import type { HeaderCandidate } from "./header-detector";
import type { TtuTableColumn } from "./types";

/**
 * Detect column horizontal boundaries from header candidates.
 *
 * @param headers - Verified header candidates belonging to the header band.
 * @param imageWidth - Total width of the original image.
 * @returns Array of TtuTableColumn ordered from left to right (x0 ascending).
 */
export function detectColumns(
  headers: HeaderCandidate[],
  imageWidth: number
): TtuTableColumn[] {
  if (headers.length === 0) return [];

  // Sort headers physically by horizontal start coordinate (left to right)
  const sorted = [...headers].sort((a, b) => a.bbox.x0 - b.bbox.x0);

  const columns: TtuTableColumn[] = [];

  // Calculate split boundaries between adjacent column header centers
  const splitPoints: number[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];

    const curCenter = (cur.bbox.x0 + cur.bbox.x1) / 2;
    const nextCenter = (next.bbox.x0 + next.bbox.x1) / 2;

    // Midpoint between centers is scale-invariant and robust to varying word widths
    const splitX = Math.round((curCenter + nextCenter) / 2);
    splitPoints.push(splitX);
  }

  for (let i = 0; i < sorted.length; i++) {
    const cand = sorted[i];

    const xStart = i === 0 ? 0 : splitPoints[i - 1];
    const xEnd = i === sorted.length - 1 ? imageWidth : splitPoints[i];

    columns.push({
      key: cand.key,
      headerText: cand.rawText,
      bbox: cand.bbox,
      xStart,
      xEnd,
      confidence: cand.confidence,
    });
  }

  return columns;
}
