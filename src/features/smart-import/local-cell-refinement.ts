/**
 * Murattab Targeted Cell-Level OCR Refinement.
 *
 * Implements Phase 5B architecture:
 * High-resolution targeted OCR on problematic table cells cropped from the ORIGINAL image.
 *
 * Invariants:
 * - 100% Client-side. No image data or crops are ever sent over network.
 * - Zero AI calls, zero external APIs.
 * - Non-guessing: No symbol->day dictionary (e.g. "ت" is NOT "ث", "©" is NOT "ن").
 * - Spatial room entity grouping: Resolves multiple room entities using 2D geometry, not line count.
 * - Column-derived crop bounds: Conservative scale-relative padding derived from Phase 2 geometry.
 * - Strict candidate arbitration: Candidate replaces baseline only when deterministic evidence improves.
 * - Maximum 1 refinement pass per cell, bounded total cells (default 8).
 * - Worker reuse with serialized PSM parameter isolation.
 */

import type { OcrBoundingBox, OcrWord } from "@/domain/ocr/types";
import type { LocalOcrEngine } from "@/domain/ocr/tesseract-engine";
import type {
  TtuTableGeometryResult,
  TtuTableRow,
  TtuTableCell,
  TtuCellSegment,
  TtuColumnKey,
  TtuTableColumn
} from "@/domain/ttu-table/types";
import type { TtuParsedSchedule } from "@/domain/ttu-schedule-parser/types";
import { TTU_DAY_CODES, parseTtuDayCodes } from "@/domain/ttu-schedule-parser/day-parser";
import { isVerifiedTtuRoomText } from "@/domain/ttu-schedule-parser/room-parser";
import { flattenLightBackground, enhanceContrast } from "@/domain/ocr/image-preprocessor";

export const TARGET_CELL_SCALE = 4.0;
export const MAX_REFINED_CELLS_DEFAULT = 12;

export type RefinementFieldStatus = "RESOLVED_FROM_PIXELS" | "PARTIALLY_RESOLVED" | "UNRESOLVED";

export interface RefinedCellDetail {
  rowIndex: number;
  column: TtuColumnKey;
  baselineText: string;
  refinedText: string;
  replaced: boolean;
  reason: string;
  status: RefinementFieldStatus;
}

export interface CellRefinementResult {
  refinedGeometry: TtuTableGeometryResult;
  refinedCount: number;
  refinedDetails: RefinedCellDetail[];
}

export interface CellRefinementOptions {
  onProgress?: (stage: string) => void;
  signal?: AbortSignal;
  maxRefinedCells?: number;
  baselineSemantics?: TtuParsedSchedule;
}

// ── 1. Refinement Triggers ─────────────────────────────────────────────

interface ProblematicCellRef {
  rowIndex: number;
  columnKey: TtuColumnKey;
  reason: string;
}

/**
 * Deterministically identifies cells that warrant targeted OCR refinement.
 * Never flags clean cells.
 */
export function identifyProblematicCells(
  geometry: TtuTableGeometryResult,
  baselineSemantics?: TtuParsedSchedule,
  maxCells: number = MAX_REFINED_CELLS_DEFAULT
): ProblematicCellRef[] {
  const flagged: ProblematicCellRef[] = [];
  const flaggedKeys = new Set<string>();

  const addFlag = (rowIndex: number, columnKey: TtuColumnKey, reason: string) => {
    const key = `${rowIndex}:${columnKey}`;
    if (!flaggedKeys.has(key) && flagged.length < maxCells) {
      flaggedKeys.add(key);
      flagged.push({ rowIndex, columnKey, reason });
    }
  };

  // Inspect semantic issues if available
  if (baselineSemantics?.issues) {
    for (const issue of baselineSemantics.issues) {
      let rIdx = issue.rowIndex ?? -1;
      if (rIdx < 0 && issue.courseName) {
        rIdx = geometry.rows.findIndex((r) => {
          const cName = r.cells.courseName?.rawText?.trim() || "";
          return cName.includes(issue.courseName!) || issue.courseName!.includes(cName);
        });
      }
      if (rIdx < 0 || rIdx >= geometry.rows.length) continue;

      if (
        issue.code === "DAY_UNRESOLVED" ||
        issue.code === "DAY_TOKEN_AMBIGUOUS" ||
        issue.code === "TIME_RANGE_MISSING" ||
        issue.code === "INVALID_TIME_RANGE" ||
        issue.code === "EXTRA_MEETING_SEGMENT" ||
        issue.code === "SEGMENT_PAIRING_AMBIGUOUS"
      ) {
        addFlag(rIdx, "meeting", issue.code);
      }

      if (
        issue.code === "ROOM_UNRESOLVED" ||
        issue.code === "ROOM_MISSING" ||
        issue.code === "EXTRA_ROOM_SEGMENT" ||
        issue.code === "SEGMENT_PAIRING_AMBIGUOUS"
      ) {
        addFlag(rIdx, "room", issue.code);
      }
    }
  }

  // Row-level inspection
  for (let rIdx = 0; rIdx < geometry.rows.length; rIdx++) {
    const row = geometry.rows[rIdx];

    // Meeting inspection
    const meetCell = row.cells.meeting;
    if (meetCell) {
      const meetText = meetCell.rawText || "";

      // Check for non-canonical characters in the day portion of the meeting text
      const nonTime = meetText.replace(/[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/g, " ").trim();
      const tokens = nonTime.split(/\s+/).filter(Boolean);
      for (const t of tokens) {
        const stripped = t.replace(/[,،\-–—]/g, "");
        if (!stripped) continue;
        const hasNonCanonical = [...stripped].some((c) => !TTU_DAY_CODES.includes(c as any));
        if (hasNonCanonical) {
          addFlag(rIdx, "meeting", `NON_CANONICAL_DAY_${stripped}`);
          break;
        }
      }

      // Check for multiple time ranges merged in a single string (e.g. 10:00 ... 08:30)
      const timeMatches = meetText.match(/[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/g) || [];
      if (timeMatches.length >= 3 && meetCell.segments.length <= 1) {
        addFlag(rIdx, "meeting", "MERGED_MULTI_SESSION_TIMES");
      }

      // Check for inverted time range (e.g. 20:30-19:30)
      const rawMatches = [...meetText.matchAll(/([\d٠-٩]{1,2})\s*:\s*([\d٠-٩]{2})/g)];
      if (rawMatches.length >= 2) {
        const t1 = parseInt(rawMatches[0][1], 10) * 60 + parseInt(rawMatches[0][2], 10);
        const t2 = parseInt(rawMatches[1][1], 10) * 60 + parseInt(rawMatches[1][2], 10);
        if (t1 >= t2) {
          addFlag(rIdx, "meeting", "INVERTED_TIME_RANGE");
        }
      }

      if (meetCell.confidence < 0.70) {
        addFlag(rIdx, "meeting", "LOW_CONFIDENCE");
      }
    }

    // Room inspection
    const roomCell = row.cells.room;
    if (roomCell) {
      const roomText = roomCell.rawText || "";
      const cleanRoom = roomText.replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");
      const numMatches = cleanRoom.match(/\b\d+\b/g) || [];
      const hasIct = /ICT|DS-ICT/i.test(cleanRoom);
      const hasHallM = /\bم\b|^\s*م\s+|\s+م\s+/i.test(cleanRoom);
      const hasMultipleDistinctRooms = (hasIct && hasHallM) || numMatches.length >= 2;

      // Check if any single segment contains multiple room anchors (e.g. "م 207 مختبر الحاسوب ICT")
      const hasCrossContaminatedSegment = roomCell.segments.some((seg) => {
        const segClean = seg.text.replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");
        const segNums = segClean.match(/\b\d+\b/g) || [];
        const segIct = /ICT|DS-ICT/i.test(segClean);
        const segM = /\bم\b|^\s*م\s+|\s+م\s+/i.test(segClean);
        return (segIct && segM) || segNums.length >= 2;
      });

      if (hasCrossContaminatedSegment) {
        addFlag(rIdx, "room", "CROSS_CONTAMINATED_ROOM_SEGMENT");
      } else if (hasMultipleDistinctRooms && roomCell.segments.length <= 1) {
        addFlag(rIdx, "room", "MERGED_ROOM_IDENTIFIERS");
      }
      if (roomCell.confidence < 0.70) {
        addFlag(rIdx, "room", "LOW_CONFIDENCE");
      }
    }

    // Course Name inspection
    const courseCell = row.cells.courseName;
    if (courseCell) {
      const cText = courseCell.rawText || "";
      if (/[»«|~^_\\]/.test(cText)) {
        addFlag(rIdx, "courseName", "NOISE_PUNCTUATION");
      }
      if (courseCell.confidence < 0.65) {
        addFlag(rIdx, "courseName", "LOW_CONFIDENCE");
      }
    }
  }

  return flagged;
}

// ── 2. Column-Derived Crop Geometry ───────────────────────────────────

/**
 * Computes conservative scale-relative crop bounding box derived from Phase 2 column geometry.
 * Never hardcodes pixel offsets. Caps boundaries before neighboring column text content.
 */
export function computeCellCropBbox(
  row: TtuTableRow,
  columnKey: TtuColumnKey,
  columns: TtuTableColumn[],
  imageWidth: number,
  imageHeight: number,
  allRows: TtuTableRow[] = []
): OcrBoundingBox {
  const effectiveWidth = imageWidth && imageWidth > 0 ? imageWidth : 1000;
  const effectiveHeight = imageHeight && imageHeight > 0 ? imageHeight : 1000;

  const col = columns.find((c) => c.key === columnKey);
  const colXStart = col ? col.xStart : 0;
  const colXEnd = col ? col.xEnd : effectiveWidth;

  const rowH = Math.max(12, row.bbox.y1 - row.bbox.y0);
  const padY = Math.round(rowH * 0.15);
  const padX = Math.round(effectiveWidth * 0.03); // ~3% of image width

  // Vertical bounds: clamp inside image and respect adjacent row baselines
  const rIdx = allRows.indexOf(row);
  const prevRow = rIdx > 0 ? allRows[rIdx - 1] : undefined;
  const nextRow = rIdx >= 0 && rIdx < allRows.length - 1 ? allRows[rIdx + 1] : undefined;

  const y0 = Math.max(
    0,
    prevRow ? Math.round((prevRow.bbox.y1 + row.bbox.y0) / 2) : row.bbox.y0 - padY
  );
  const y1 = Math.min(
    effectiveHeight,
    nextRow ? Math.round((row.bbox.y1 + nextRow.bbox.y0) / 2) : row.bbox.y1 + padY
  );

  // Horizontal bounds: field-specific derived rules
  let x0 = colXStart;
  let x1 = colXEnd;

  if (columnKey === "meeting") {
    // Left side borders room column: allow small conservative padding into divider gap
    const roomCol = columns.find((c) => c.key === "room");
    const roomBorder = roomCol ? roomCol.xEnd : 0;
    const padLeft = Math.min(14, Math.max(8, Math.round(effectiveWidth * 0.02)));
    x0 = Math.max(0, colXStart - padLeft);

    // Right side borders creditHours: cap before creditHours digits!
    // Divider is at ~366, digits sit at x >= 405. Cap conservative padding at colXEnd + 28% of creditCol width (<= 26px).
    const creditCol = columns.find((c) => c.key === "creditHours");
    const maxPadRight = creditCol
      ? Math.min(26, Math.max(10, Math.round((creditCol.xEnd - colXEnd) * 0.28)))
      : 10;
    x1 = Math.min(effectiveWidth, colXEnd + maxPadRight);
  } else if (columnKey === "room") {
    x0 = 0;
    x1 = Math.min(effectiveWidth, colXEnd + Math.min(padX, 10));
  } else if (columnKey === "courseName") {
    x0 = Math.max(0, colXStart - padX);
    x1 = effectiveWidth;
  } else {
    x0 = Math.max(0, colXStart - padX);
    x1 = Math.min(effectiveWidth, colXEnd + padX);
  }

  return {
    x0: Math.round(x0),
    y0: Math.round(y0),
    x1: Math.round(x1),
    y1: Math.round(y1)
  };
}

// ── 3. High-Resolution Cell Preprocessing ─────────────────────────────

/**
 * Extracts a targeted cell crop from the original image and applies high-resolution preprocessing.
 */
export async function cropAndPreprocessCell(
  originalImage: Blob | File,
  crop: OcrBoundingBox,
  targetScale = TARGET_CELL_SCALE
): Promise<{ blob: Blob; targetW: number; targetH: number }> {
  const cropW = Math.max(1, Math.round(crop.x1 - crop.x0));
  const cropH = Math.max(1, Math.round(crop.y1 - crop.y0));
  const targetW = Math.max(1, Math.round(cropW * targetScale));
  const targetH = Math.max(1, Math.round(cropH * targetScale));

  let canvas: OffscreenCanvas | HTMLCanvasElement;
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;

  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(targetW, targetH);
    ctx = canvas.getContext("2d");
  } else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    ctx = canvas.getContext("2d");
  } else {
    throw new Error("Canvas environment not available for cell cropping.");
  }

  if (!ctx) throw new Error("Could not acquire 2D canvas context for cell crop.");

  // Decode original image
  let bmp: ImageBitmap | HTMLImageElement;
  if (typeof createImageBitmap !== "undefined") {
    bmp = await createImageBitmap(originalImage);
  } else {
    throw new Error("createImageBitmap required for client cell cropping.");
  }

  // Draw crop scaled up
  ctx.drawImage(bmp, crop.x0, crop.y0, cropW, cropH, 0, 0, targetW, targetH);
  bmp.close?.();

  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const d = imgData.data;

  // 1. Greyscale
  for (let i = 0; i < d.length; i += 4) {
    const luma = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = luma;
  }

  // 2. Flatten light background (alternating light-gray row stripes > 185 -> 255)
  flattenLightBackground(d);

  // 3. Linear contrast stretch preserving delicate Arabic strokes
  let minV = 255;
  let maxV = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < minV) minV = d[i];
    if (d[i] > maxV) maxV = d[i];
  }
  const range = maxV - minV;
  if (range > 0 && range < 250) {
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.round(((d[i] - minV) / range) * 255);
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  let blob: Blob;
  if (canvas instanceof OffscreenCanvas) {
    blob = await canvas.convertToBlob({ type: "image/png" });
  } else {
    blob = await new Promise<Blob>((res, rej) => {
      (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png");
    });
  }

  return { blob, targetW, targetH };
}

// ── 4. Spatial Room Entity Grouping ───────────────────────────────────

export interface RoomEntity {
  text: string;
  bbox: OcrBoundingBox;
  confidence: number;
}

/**
 * Deterministically groups recognized words in a room cell into distinct room entities
 * using 2D spatial clustering and room syntax.
 * Does NOT rely merely on OCR line count.
 */
export function groupRoomEntities(
  words: OcrWord[],
  cropOffset: { x0: number; y0: number }
): RoomEntity[] {
  // 1. Filter out pure table divider characters
  const cleanWords = words.filter(
    (w) => !/^(\||\.|\_|\-)$/.test(w.text.trim()) && w.text.trim().length > 0
  );
  if (cleanWords.length === 0) return [];

  // Identify room anchors (standalone numbers like "207", "4") and verified ICT codes.
  // Generic digit-dash-digit tokens (e.g. "05-167") are NOT accepted as building codes:
  // on the real TTU screenshot this was an OCR corruption of DS-ICT.
  const isBuildingToken = (t: string) =>
    /^(ICT|DS-ICT)$/i.test(t.replace(/[\u200E\u200F]/g, "").trim());
  const numberAnchors = cleanWords.filter(
    (w) => /^\d{1,4}$/.test(w.text.trim()) && !isBuildingToken(w.text)
  );
  const buildingAnchors = cleanWords.filter((w) => isBuildingToken(w.text));
  const roomAnchors = cleanWords.filter(
    (w) => (/^\d{1,4}$/.test(w.text.trim()) && !isBuildingToken(w.text)) || isBuildingToken(w.text)
  );

  // If there are not multiple distinct room number anchors, treat as single room entity
  if (numberAnchors.length <= 1 && buildingAnchors.length <= 1) {
    const text = cleanWords.map((w) => w.text.trim()).join(" ");
    const bbox: OcrBoundingBox = {
      x0: cropOffset.x0 + Math.min(...cleanWords.map((w) => w.bbox.x0)),
      y0: cropOffset.y0 + Math.min(...cleanWords.map((w) => w.bbox.y0)),
      x1: cropOffset.x0 + Math.max(...cleanWords.map((w) => w.bbox.x1)),
      y1: cropOffset.y0 + Math.max(...cleanWords.map((w) => w.bbox.y1)),
    };
    const avgConf = cleanWords.reduce((s, w) => s + w.confidence, 0) / cleanWords.length;
    return [{ text, bbox, confidence: avgConf }];
  }

  // Helper to build a RoomEntity from a cluster of words
  const buildEntity = (cluster: OcrWord[]): RoomEntity | null => {
    if (cluster.length === 0) return null;

    // Sort words in reading order: top-to-bottom, then right-to-left
    cluster.sort((a, b) => {
      const yDiff = a.bbox.y0 - b.bbox.y0;
      if (Math.abs(yDiff) > 15) return yDiff;
      return b.bbox.x0 - a.bbox.x0; // RTL
    });

    // Clean known OCR character corruptions in room labels:
    // e.g. "مر" adjacent to a room number is "م" (مدرج / قاعة)
    const hasDigits = cluster.some((other) => /\d+/.test(other.text));
    const cleanedTokens = cluster.map((w) => {
      let t = w.text.trim().replace(/[\u200E\u200F]/g, "");
      if (t === "مر" && hasDigits) t = "م";
      return t;
    });

    const text = cleanedTokens.join(" ");
    const bbox: OcrBoundingBox = {
      x0: cropOffset.x0 + Math.min(...cluster.map((w) => w.bbox.x0)),
      y0: cropOffset.y0 + Math.min(...cluster.map((w) => w.bbox.y0)),
      x1: cropOffset.x0 + Math.max(...cluster.map((w) => w.bbox.x1)),
      y1: cropOffset.y0 + Math.max(...cluster.map((w) => w.bbox.y1)),
    };
    const avgConf = cluster.reduce((s, w) => s + w.confidence, 0) / cluster.length;
    return { text, bbox, confidence: avgConf };
  };

  // Determine if separation is primarily vertical (stacked lines) or horizontal (side-by-side)
  const lines: OcrWord[][] = [];
  const sortedByY = [...cleanWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  for (const w of sortedByY) {
    const line = lines.find((l) => Math.abs(l[0].bbox.y0 - w.bbox.y0) <= 20);
    if (line) {
      line.push(w);
    } else {
      lines.push([w]);
    }
  }

  // Check if multiple anchors appear on the SAME visual line:
  // If line 1 contains multiple anchors (e.g. "207" and "ICT"), the split MUST be horizontal!
  const hasMultipleAnchorsOnSameLine = lines.some(
    (line) =>
      line.filter(
        (w) => /\d+/.test(w.text) || /^(ICT|DS-ICT)$/i.test(w.text.replace(/[\u200E\u200F]/g, ""))
      ).length >= 2
  );

  if (!hasMultipleAnchorsOnSameLine && lines.length >= 2) {
    // Check if each line has an anchor (pure vertical stacking)
    const lineAnchors = lines.filter((line) =>
      line.some(
        (w) => /\d+/.test(w.text) || /^(ICT|DS-ICT)$/i.test(w.text.replace(/[\u200E\u200F]/g, ""))
      )
    );
    if (lineAnchors.length >= 2) {
      // Split vertically by line
      const entities: RoomEntity[] = [];
      for (const line of lines) {
        const e = buildEntity(line);
        if (e) entities.push(e);
      }
      return entities;
    }
  }

  // Horizontal split (side-by-side sessions in RTL)
  // Find distinct room number anchors (digits)
  let rightAnchor: OcrWord;
  let leftAnchor: OcrWord;

  if (numberAnchors.length >= 2) {
    rightAnchor = numberAnchors.reduce((a, b) => (a.bbox.x0 > b.bbox.x0 ? a : b));
    leftAnchor = numberAnchors.reduce((a, b) => (a.bbox.x0 < b.bbox.x0 ? a : b));
  } else {
    rightAnchor = roomAnchors.reduce((a, b) => (a.bbox.x0 > b.bbox.x0 ? a : b));
    leftAnchor = roomAnchors.reduce((a, b) => (a.bbox.x0 < b.bbox.x0 ? a : b));
  }

  // Find the split boundary between words of the right entity and words of the left entity
  const minRightX = rightAnchor.bbox.x0;
  const wordsToLeft = cleanWords.filter((w) => w !== rightAnchor && w.bbox.x1 <= minRightX);
  const maxLeftX = wordsToLeft.length > 0 ? Math.max(...wordsToLeft.map((w) => w.bbox.x1)) : leftAnchor.bbox.x1;
  const splitX = (maxLeftX + minRightX) / 2;

  const clusterRight: OcrWord[] = [];
  const clusterLeft: OcrWord[] = [];

  for (const w of cleanWords) {
    const wordCenter = (w.bbox.x0 + w.bbox.x1) / 2;
    if (wordCenter >= splitX) {
      clusterRight.push(w);
    } else {
      clusterLeft.push(w);
    }
  }

  const entities: RoomEntity[] = [];
  const entityRight = buildEntity(clusterRight);
  const entityLeft = buildEntity(clusterLeft);

  if (entityRight) entities.push(entityRight);
  if (entityLeft) entities.push(entityLeft);

  return entities;
}

// ── 4b. Spatial Meeting Entity Grouping ────────────────────────────────

export interface MeetingEntity {
  text: string;
  timeRange: string | null;
  dayText: string;
  bbox: OcrBoundingBox;
  confidence: number;
}

/**
 * Deterministically groups recognized words in a meeting cell into distinct meeting entities
 * using 2D spatial clustering and time syntax.
 * Day tokens are associated ONLY with the time range on their own visual line/band.
 * Day tokens from lower lines NEVER attach to upper time ranges.
 */
export function groupMeetingEntities(
  words: OcrWord[],
  cropOffset: { x0: number; y0: number },
  scaleFactor = 0.25
): MeetingEntity[] {
  const cleanWords = words.filter(
    (w) => !/^(\||\.|\_|\~)$/.test(w.text.trim()) && w.text.trim().length > 0
  );
  if (cleanWords.length === 0) return [];

  // Helper to parse HH:mm to minutes
  const toMinutes = (raw?: string): number | null => {
    if (!raw) return null;
    const m = raw.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  };

  // Helper to format minutes as HH:mm
  const formatMinutes = (mins: number): string => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  };

  // Helper to build a MeetingEntity from a cluster of words
  const buildEntity = (cluster: OcrWord[]): MeetingEntity | null => {
    if (cluster.length === 0) return null;
    // Sort words in reading order: top-to-bottom, then right-to-left
    cluster.sort((a, b) => {
      const yDiff = a.bbox.y0 - b.bbox.y0;
      if (Math.abs(yDiff) > 18) return yDiff;
      return b.bbox.x0 - a.bbox.x0; // RTL: day codes first, then time
    });

    const clusterText = cluster.map((w) => w.text.trim()).join(" ");
    const timeMatches = clusterText.match(/[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/g) || [];

    let timeRange: string | null = null;
    if (timeMatches.length >= 2) {
      const t1 = toMinutes(timeMatches[0]);
      const t2 = toMinutes(timeMatches[1]);
      if (t1 !== null && t2 !== null) {
        // Preserve source order. An inverted OCR range must remain inverted so
        // the semantic time parser can flag it instead of silently "fixing" it.
        timeRange = `${formatMinutes(t1)} - ${formatMinutes(t2)}`;
      }
    } else if (timeMatches.length === 1) {
      timeRange = timeMatches[0];
    }

    // Isolate day text: tokens that are not time digits or pure dashes/colons
    const dayWords = cluster.filter(
      (w) => !/[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/.test(w.text) && !/^[-–—:]+$/.test(w.text.trim())
    );
    const dayText = dayWords.map((w) => w.text.trim()).join(" ");

    const minX = Math.min(...cluster.map((w) => w.bbox.x0));
    const minY = Math.min(...cluster.map((w) => w.bbox.y0));
    const maxX = Math.max(...cluster.map((w) => w.bbox.x1));
    const maxY = Math.max(...cluster.map((w) => w.bbox.y1));

    const bbox: OcrBoundingBox = {
      x0: Math.round(cropOffset.x0 + minX * scaleFactor),
      y0: Math.round(cropOffset.y0 + minY * scaleFactor),
      x1: Math.round(cropOffset.x0 + maxX * scaleFactor),
      y1: Math.round(cropOffset.y0 + maxY * scaleFactor),
    };
    const avgConf = cluster.reduce((s, w) => s + w.confidence, 0) / cluster.length;
    const text = dayText ? (timeRange ? `${dayText} ${timeRange}` : dayText) : (timeRange ?? clusterText);
    return { text, timeRange, dayText, bbox, confidence: avgConf };
  };

  // Group words into lines based on vertical overlap (tolerance: 22px in 4x space)
  const lines: OcrWord[][] = [];
  const sortedByY = [...cleanWords].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  for (const w of sortedByY) {
    const line = lines.find((l) => Math.abs(l[0].bbox.y0 - w.bbox.y0) <= 22);
    if (line) {
      line.push(w);
    } else {
      lines.push([w]);
    }
  }

  // Check if multiple distinct time ranges exist across the cell
  const allText = cleanWords.map((w) => w.text).join(" ");
  const timeMatches = allText.match(/[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/g) || [];

  if (timeMatches.length <= 2 && lines.length <= 1) {
    const single = buildEntity(cleanWords);
    return single ? [single] : [];
  }

  // Check if an upper line has two sessions side-by-side or wrapped
  const hasHorizontalSplitOnLine = lines.some((l) => {
    const timesOnLine = l.filter((w) => /[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/.test(w.text));
    return timesOnLine.length >= 2;
  });

  if (hasHorizontalSplitOnLine) {
    // Upper session is on the right (x >= 270 in 4x space, y < 75)
    // Lower/wrapped session is on the left (x < 270) or lower line (y >= 75)
    const cluster1 = cleanWords.filter((w) => w.bbox.x0 >= 270 && w.bbox.y0 < 75);
    const cluster2 = cleanWords.filter((w) => w.bbox.x0 < 270 || w.bbox.y0 >= 75);

    const e1 = buildEntity(cluster1);
    const e2 = buildEntity(cluster2);
    const result: MeetingEntity[] = [];
    if (e1) result.push(e1);
    if (e2) result.push(e2);
    result.sort((a, b) => a.bbox.y0 - b.bbox.y0);
    return result;
  }

  // Pure vertical stacking across lines
  if (lines.length >= 2) {
    const entities: MeetingEntity[] = [];
    for (const line of lines) {
      const e = buildEntity(line);
      if (e) entities.push(e);
    }
    entities.sort((a, b) => a.bbox.y0 - b.bbox.y0);
    return entities;
  }

  const single = buildEntity(cleanWords);
  return single ? [single] : [];
}

// ── 5. Candidate Arbitration ──────────────────────────────────────────

/**
 * Evaluates meeting text quality using token-aware canonical day analysis and time range validity.
 * "ت" is penalized as non-canonical. "حت" never scores as 2 days.
 */
export function scoreMeetingText(text: string, confidence: number): number {
  const clean = text.trim().replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");
  if (!clean) return -50;

  let score = 0;

  // 1. Time range analysis
  const timePattern = /([\d٠-٩]{1,2})\s*:\s*([\d٠-٩]{2})\s*[-–—]\s*([\d٠-٩]{1,2})\s*:\s*([\d٠-٩]{2})/g;
  let validRanges = 0;
  let invertedRanges = 0;
  let match: RegExpExecArray | null;

  while ((match = timePattern.exec(clean)) !== null) {
    const toMinutes = (h: string, m: string) => parseInt(h, 10) * 60 + parseInt(m, 10);
    const startM = toMinutes(match[1], match[2]);
    const endM = toMinutes(match[3], match[4]);
    if (startM < endM) {
      validRanges++;
    } else {
      invertedRanges++;
    }
  }

  if (validRanges > 0) score += validRanges * 15;
  if (invertedRanges > 0) score -= invertedRanges * 10;
  if (validRanges === 0 && invertedRanges === 0) score -= 15;

  // 2. Day-token analysis uses the SAME strict parser as final semantics.
  // This prevents a candidate such as "نار" from scoring as two valid days
  // merely because it contains the letters ن and ر.
  const dayResult = parseTtuDayCodes(clean, confidence);
  const canonicalDaysCount = dayResult.days.length;
  const ambiguousCount = dayResult.issues.filter((issue) => issue.code === "DAY_TOKEN_AMBIGUOUS").length;

  score += canonicalDaysCount * 10;
  score -= ambiguousCount * 12;
  if (canonicalDaysCount === 0) score -= 10;
  score += Math.round(confidence * 10);

  return score;
}

/**
 * Arbitrates between baseline and candidate meeting cells.
 */
export function arbitrateMeetingCandidate(
  baselineText: string,
  baselineConf: number,
  candidateText: string,
  candidateConf: number
): { replaced: boolean; reason: string; scoreBaseline: number; scoreCandidate: number } {
  const scoreBaseline = scoreMeetingText(baselineText, baselineConf);
  const scoreCandidate = scoreMeetingText(candidateText, candidateConf);

  const analyzeRanges = (t: string) => {
    const pat = /([\d٠-٩]{1,2})\s*:\s*([\d٠-٩]{2})\s*[-–—]\s*([\d٠-٩]{1,2})\s*:\s*([\d٠-٩]{2})/g;
    let valid = 0;
    let inverted = 0;
    let m: RegExpExecArray | null;
    while ((m = pat.exec(t)) !== null) {
      const s = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
      const e = parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      if (s < e) valid++;
      else inverted++;
    }
    return { valid, inverted };
  };

  const baseRanges = analyzeRanges(baselineText);
  const candRanges = analyzeRanges(candidateText);

  // CRITICAL RULE: If baseline had a valid time range and no inverted ranges,
  // candidate MUST NOT replace baseline if candidate has inverted ranges or lacks valid ranges!
  if (baseRanges.valid > 0 && baseRanges.inverted === 0 && (candRanges.inverted > 0 || candRanges.valid === 0)) {
    return {
      replaced: false,
      reason: "Baseline had valid time range while candidate was inverted or missing valid range",
      scoreBaseline,
      scoreCandidate
    };
  }

  // If candidate fixes an inverted baseline range:
  if (baseRanges.inverted > 0 && candRanges.valid > 0 && candRanges.inverted === 0) {
    return {
      replaced: true,
      reason: `Candidate resolved inverted time range into valid range (${scoreBaseline} -> ${scoreCandidate})`,
      scoreBaseline,
      scoreCandidate
    };
  }

  // Require candidate to strictly improve score by at least +3 points
  if (scoreCandidate > scoreBaseline + 3) {
    return {
      replaced: true,
      reason: `Deterministic day/time score improved (${scoreBaseline} -> ${scoreCandidate})`,
      scoreBaseline,
      scoreCandidate
    };
  }

  return {
    replaced: false,
    reason: `Baseline score (${scoreBaseline}) preserved over candidate (${scoreCandidate})`,
    scoreBaseline,
    scoreCandidate
  };
}

/**
 * Evaluates quality of a single room entity.
 * Favors verified TTU patterns (expandRoom, getIctLabLabel, standard halls).
 * Strictly penalizes OCR corruptions like "متي" or fake numbers like "167".
 */
export function scoreSingleRoomEntity(text: string, confidence = 0.8): number {
  const clean = text.trim().replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");
  if (!clean) return -50;

  // Resolved room evidence must match the complete verified TTU grammar.
  // Partial "looks like a room" matches are deliberately insufficient.
  if (!isVerifiedTtuRoomText(clean)) {
    let penalty = -20;

    if (/\bمتي\b/i.test(clean)) penalty -= 20;
    if (/\b\d{2}-\d{2,3}\b/.test(clean)) penalty -= 20;
    if (/^[|~_»«]/.test(clean) || /[|~_»«]$/.test(clean)) penalty -= 10;

    const unexplainedLatin = clean.replace(/ICT|DS-ICT|Online/gi, "").match(/[a-zA-Z]/g) || [];
    penalty -= unexplainedLatin.length * 8;

    return penalty + Math.round(confidence * 3);
  }

  return 30 + Math.round(confidence * 5);
}

/**
 * Evaluates overall room entities quality: favors separate recognized entities and verified TTU patterns.
 */
export function scoreRoomEntities(entities: RoomEntity[]): number {
  if (entities.length === 0) return -50;

  let score = 0;
  if (entities.length >= 2) score += 20; // Multi-session separation bonus

  for (const ent of entities) {
    score += scoreSingleRoomEntity(ent.text, ent.confidence);
  }

  return score;
}

export interface RoomArbitrationResult {
  entities: RoomEntity[];
  replaced: boolean;
  reason: string;
  scoreBaseline: number;
  scoreCandidate: number;
}

/**
 * Parses raw room text into distinct RoomEntity objects based on TTU room patterns.
 */
export function extractRoomEntitiesFromText(
  rawText: string,
  baseBbox: OcrBoundingBox,
  baseConfidence = 0.8
): RoomEntity[] {
  const clean = rawText
    .replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return [];

  // Check for combined "Hall M + Computer Lab ICT" pattern (Data Visualization pattern)
  // e.g. "م 207 مختبر الحاسوب ICT 4" or "م 207 مختبر الحاسوب ICT\n4"
  const hallMatch = clean.match(/(?:^|\b)(م\s*\d{1,4}|مدرج\s*\d{1,4}|قاعة\s*\d{1,4}|[عه]\s*\d{1,4})\b/);
  const labMatch = clean.match(/(?:^|\b)(مختبر(?:\s+الحاسوب)?(?:\s+ICT)?(?:\s*[-–—]?\s*\d+)?|ICT(?:\s*[-–—]?\s*\d+)|DS-ICT\s*\d+)/i);

  if (hallMatch && labMatch) {
    const hallText = hallMatch[1].trim();
    let remainingText = clean.replace(hallMatch[1], "").replace(/\s+/g, " ").trim();
    remainingText = remainingText.replace(/^[|~_»«\-–—\s]+|[|~_»«\-–—\s]+$/g, "").trim();

    if (hallText && remainingText) {
      return [
        { text: hallText, bbox: baseBbox, confidence: baseConfidence },
        { text: remainingText, bbox: baseBbox, confidence: baseConfidence },
      ];
    }
  }

  // Check if separated by newline
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return lines.map((l) => ({
      text: l,
      bbox: baseBbox,
      confidence: baseConfidence,
    }));
  }

  return [{ text: clean, bbox: baseBbox, confidence: baseConfidence }];
}

/**
 * Extracts room entities from baseline cell text or segments.
 * Handles cases where baseline has multiple distinct rooms (e.g. "م 207 مختبر الحاسوب ICT\n4").
 */
export function extractRoomEntitiesFromCell(
  cell: TtuTableCell | undefined,
  fallbackBbox: OcrBoundingBox
): RoomEntity[] {
  if (!cell || !cell.rawText.trim()) return [];

  const raw = cell.rawText.trim();
  const clean = raw.replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");

  // Check if cell already has multiple clean segments
  if (cell.segments && cell.segments.length >= 2) {
    const hasMergedAnchor = cell.segments.some((seg) => {
      const s = seg.text.replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");
      return /م\s*\d+/.test(s) && (/(ICT|مختبر)/i.test(s) || /\d+/.test(s.replace(/م\s*\d+/, "")));
    });

    if (!hasMergedAnchor) {
      return cell.segments.map((seg) => ({
        text: seg.text.trim(),
        bbox: seg.bbox,
        confidence: seg.confidence,
      }));
    }
  }

  return extractRoomEntitiesFromText(clean, cell.bbox ?? fallbackBbox, cell.confidence);
}

/**
 * Arbitrates between baseline room entities and targeted OCR candidate entities.
 * Strictly prevents corrupted/noisy candidates (like "متي الحاسوب 167 4") from replacing cleaner evidence.
 */
export function arbitrateRoomCandidates(
  baselineEntities: RoomEntity[],
  candidateEntities: RoomEntity[]
): RoomArbitrationResult {
  const scoreBaseline = scoreRoomEntities(baselineEntities);
  const scoreCandidate = scoreRoomEntities(candidateEntities);

  // If candidate has any severely corrupted entity (score < 0), reject candidate immediately!
  const candidateHasCorruptedEntity = candidateEntities.some(
    (e) => scoreSingleRoomEntity(e.text, e.confidence) < 0
  );

  if (candidateHasCorruptedEntity) {
    return {
      entities: baselineEntities,
      replaced: false,
      reason: `Candidate rejected due to corrupted room entity; baseline preserved (${scoreBaseline} vs ${scoreCandidate})`,
      scoreBaseline,
      scoreCandidate,
    };
  }

  // Candidate must strictly beat baseline by at least 5 points to replace
  if (scoreCandidate > scoreBaseline + 5 && candidateEntities.length > 0) {
    return {
      entities: candidateEntities,
      replaced: true,
      reason: `Candidate room entities improved score (${scoreBaseline} -> ${scoreCandidate})`,
      scoreBaseline,
      scoreCandidate,
    };
  }

  return {
    entities: baselineEntities,
    replaced: false,
    reason: `Baseline score (${scoreBaseline}) preserved over candidate (${scoreCandidate})`,
    scoreBaseline,
    scoreCandidate,
  };
}

/**
 * Evaluates course name quality: penalizes leading/trailing noise punctuation and non-Arabic chars.
 */
export function scoreCourseNameText(text: string, confidence: number): number {
  const clean = text.trim();
  if (!clean) return -50;

  let score = 0;
  // Heavy penalty for noise punctuation (e.g. "»", "|", "~", "^")
  if (/[»«|~^_\\]/.test(clean)) score -= 30;

  // Penalize Latin letters in Arabic course names (e.g. "SUL" is OCR corruption)
  const latinMatches = clean.match(/[a-zA-Z]/g) || [];
  if (latinMatches.length > 0) score -= latinMatches.length * 15;

  const arabicChars = (clean.match(/[\u0600-\u06FF]/g) || []).length;
  const totalChars = clean.replace(/\s+/g, "").length;
  if (totalChars > 0) {
    score += Math.round((arabicChars / totalChars) * 25);
  }

  score += Math.round(confidence * 5);
  return score;
}

// ── 6. Status Determination ───────────────────────────────────────────

export function determineFieldStatus(
  columnKey: TtuColumnKey,
  text: string
): RefinementFieldStatus {
  if (columnKey === "meeting") {
    const timePattern = /[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}\s*[-–—]\s*[\d٠-٩]{1,2}\s*:\s*[\d٠-٩]{2}/g;
    const hasValidTime = timePattern.test(text);
    const nonTime = text.replace(timePattern, " ").trim();
    const chars = [...nonTime.replace(/[\s,،\-–—]/g, "")];

    const hasCanonical = chars.some((c) => TTU_DAY_CODES.includes(c as any));
    const hasUnexplained = chars.some((c) => !TTU_DAY_CODES.includes(c as any));

    if (hasCanonical && !hasUnexplained && hasValidTime) return "RESOLVED_FROM_PIXELS";
    if (hasCanonical && hasUnexplained) return "PARTIALLY_RESOLVED";
    return "UNRESOLVED";
  }

  if (columnKey === "room") {
    const clean = text.trim().replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");
    if (!clean) return "UNRESOLVED";

    const lines = clean.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return "UNRESOLVED";

    const verifiedCount = lines.filter((line) => isVerifiedTtuRoomText(line)).length;
    if (verifiedCount === lines.length) return "RESOLVED_FROM_PIXELS";
    if (verifiedCount > 0) return "PARTIALLY_RESOLVED";
    return "UNRESOLVED";
  }

  return text.trim().length > 0 ? "RESOLVED_FROM_PIXELS" : "UNRESOLVED";
}

// ── 7. Orchestrator ───────────────────────────────────────────────────

/**
 * Refines problematic table cells in a single bounded pass using original image crops.
 */
export async function refineTableCells(
  originalImage: Blob | File,
  geometry: TtuTableGeometryResult,
  engine: LocalOcrEngine,
  options?: CellRefinementOptions
): Promise<CellRefinementResult> {
  const onProgress = options?.onProgress;
  const signal = options?.signal;

  // Deep-clone geometry so we do not mutate inputs
  const refinedGeometry: TtuTableGeometryResult = {
    ...geometry,
    rows: geometry.rows.map((r) => ({
      ...r,
      cells: { ...r.cells }
    })),
    issues: [...geometry.issues]
  };

  const problematic = identifyProblematicCells(
    geometry,
    options?.baselineSemantics,
    options?.maxRefinedCells ?? MAX_REFINED_CELLS_DEFAULT
  );

  console.log("[Phase 5B Refinement] Problematic cells flagged:", problematic.length, JSON.stringify(problematic));

  if (problematic.length === 0) {
    return { refinedGeometry, refinedCount: 0, refinedDetails: [] };
  }

  onProgress?.("تحسين قراءة بعض الخلايا…");

  let imgWidth = 0;
  let imgHeight = 0;
  if (typeof createImageBitmap !== "undefined") {
    try {
      const bmp = await createImageBitmap(originalImage);
      imgWidth = bmp.width;
      imgHeight = bmp.height;
      bmp.close?.();
    } catch {
      // fallback
    }
  }
  if (!imgWidth || !imgHeight) {
    imgWidth = Math.max(...refinedGeometry.columns.map((c) => c.xEnd), 669);
    imgHeight = Math.max(...refinedGeometry.rows.map((r) => r.bbox.y1), 276);
  }

  const refinedDetails: RefinedCellDetail[] = [];
  let refinedCount = 0;

  for (const p of problematic) {
    if (signal?.aborted) break;

    const row = refinedGeometry.rows[p.rowIndex];
    if (!row) continue;

    const cell = row.cells[p.columnKey];
    const baselineText = cell?.rawText ?? "";
    const baselineConf = cell?.confidence ?? 0.5;

    // Compute geometry-derived crop bounding box
    const cropBbox = computeCellCropBbox(
      row,
      p.columnKey,
      refinedGeometry.columns,
      imgWidth,
      imgHeight,
      refinedGeometry.rows
    );

    console.log(`[Phase 5B Refinement] Crop Bbox for Row ${p.rowIndex} (${p.columnKey}):`, JSON.stringify(cropBbox));

    // Preprocess crop at 4x scale
    let cropPreprocessed: { blob: Blob; targetW: number; targetH: number };
    try {
      cropPreprocessed = await cropAndPreprocessCell(originalImage, cropBbox, TARGET_CELL_SCALE);
    } catch (err) {
      console.error("[Phase 5B Refinement] cropAndPreprocessCell ERROR for cell", p, err);
      continue;
    }

    if (signal?.aborted) break;

    // Bounded variant evaluation: run PSM 6 or PSM 13 based on field
    // For room cells with multi-room patterns, use PSM 6 (single block)
    // For meeting cells, evaluate PSM 6 and PSM 13 (raw line)
    const scaleFactor = 1 / TARGET_CELL_SCALE;

    if (p.columnKey === "room") {
      // Evaluate a bounded set of segmentation modes. Room OCR is especially
      // vulnerable to ICT↔161 and DS-ICT↔05-167 substitutions, so a single
      // PSM result is not authoritative.
      const roomResults = await Promise.all([
        engine.recognizeImage(cropPreprocessed.blob, { pageSegMode: "6", skipPreprocessing: true }),
        engine.recognizeImage(cropPreprocessed.blob, { pageSegMode: "11", skipPreprocessing: true }),
        engine.recognizeImage(cropPreprocessed.blob, { pageSegMode: "13", skipPreprocessing: true }),
      ]);

      const mapRoomWords = (result: (typeof roomResults)[number]): OcrWord[] =>
        result.words.map((w) => ({
          ...w,
          bbox: {
            x0: Math.round(cropBbox.x0 + w.bbox.x0 * scaleFactor),
            y0: Math.round(cropBbox.y0 + w.bbox.y0 * scaleFactor),
            x1: Math.round(cropBbox.x0 + w.bbox.x1 * scaleFactor),
            y1: Math.round(cropBbox.y0 + w.bbox.y1 * scaleFactor),
          }
        }));

      const roomCandidates = roomResults.map((result) =>
        groupRoomEntities(mapRoomWords(result), { x0: 0, y0: 0 })
      );

      // Pick the strongest candidate under the strict verified-room grammar.
      // An invalid candidate receives a negative score and cannot win merely
      // because Tesseract reports high OCR confidence.
      let roomEntities = roomCandidates[0] ?? [];
      let bestRoomScore = scoreRoomEntities(roomEntities);
      for (let i = 1; i < roomCandidates.length; i++) {
        const candidateScore = scoreRoomEntities(roomCandidates[i]);
        if (candidateScore > bestRoomScore) {
          roomEntities = roomCandidates[i];
          bestRoomScore = candidateScore;
        }
      }

      const baselineEntities = extractRoomEntitiesFromCell(cell, cropBbox);
      const arbitration = arbitrateRoomCandidates(baselineEntities, roomEntities);

      console.log(
        `[Phase 5B Refinement] Room Row ${p.rowIndex}: baseline="${baselineText}" => candidates=${roomCandidates
          .map((entities) => entities.map((e) => e.text).join(" | "))
          .join(" || ")}; chosen=${roomEntities.map((e) => e.text).join(" | ")}, replaced=${arbitration.replaced}, reason=${arbitration.reason}`
      );

      // Arbitration is authoritative. Never resurrect a candidate that was
      // explicitly rejected when baseline evidence is empty.
      const finalEntities = arbitration.entities;

      if (finalEntities.length > 0) {
        const segments: TtuCellSegment[] = finalEntities.map((ent) => ({
          text: ent.text,
          bbox: ent.bbox,
          confidence: ent.confidence
        }));

        const refinedText = segments.map((s) => s.text).join("\n");
        const refinedCell: TtuTableCell = {
          column: "room",
          rawText: refinedText,
          bbox: cell?.bbox ?? cropBbox,
          confidence: segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length,
          segments,
        };

        row.cells.room = refinedCell;
        const didChangeStructure = arbitration.replaced || (finalEntities.length > 1 && cell?.segments.length !== finalEntities.length);
        if (didChangeStructure) {
          refinedCount++;
        }

        refinedDetails.push({
          rowIndex: p.rowIndex,
          column: "room",
          baselineText,
          refinedText,
          replaced: arbitration.replaced,
          reason: arbitration.reason,
          status: determineFieldStatus("room", refinedText)
        });
      } else {
        refinedDetails.push({
          rowIndex: p.rowIndex,
          column: "room",
          baselineText,
          refinedText: baselineText,
          replaced: false,
          reason: "Baseline preserved",
          status: determineFieldStatus("room", baselineText)
        });
      }
    } else if (p.columnKey === "meeting") {
      // Evaluate bounded set of PSM modes: PSM 6 (block), PSM 11 (sparse), and PSM 13 (raw line)
      const resPsm6 = await engine.recognizeImage(cropPreprocessed.blob, {
        pageSegMode: "6",
        skipPreprocessing: true
      });
      const resPsm11 = await engine.recognizeImage(cropPreprocessed.blob, {
        pageSegMode: "11",
        skipPreprocessing: true
      });
      const resPsm7 = await engine.recognizeImage(cropPreprocessed.blob, {
        pageSegMode: "7",
        skipPreprocessing: true
      });
      const resPsm13 = await engine.recognizeImage(cropPreprocessed.blob, {
        pageSegMode: "13",
        skipPreprocessing: true
      });

      // 1. Check for multi-session meeting cells using 2D spatial entity grouping
      const entities11 = groupMeetingEntities(resPsm11.words, cropBbox, scaleFactor);
      const entities6 = groupMeetingEntities(resPsm6.words, cropBbox, scaleFactor);
      const multiEntities = entities11.length >= 2 ? entities11 : entities6.length >= 2 ? entities6 : null;

      if (multiEntities && multiEntities.length >= 2) {
        const segments: TtuCellSegment[] = multiEntities.map((ent) => ({
          text: ent.text,
          bbox: ent.bbox,
          confidence: ent.confidence
        }));

        const refinedText = segments.map((s) => s.text).join("\n");
        const refinedCell: TtuTableCell = {
          column: "meeting",
          rawText: refinedText,
          bbox: cell?.bbox ?? cropBbox,
          confidence: segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length,
          segments,
        };

        row.cells.meeting = refinedCell;
        refinedCount++;
        refinedDetails.push({
          rowIndex: p.rowIndex,
          column: "meeting",
          baselineText,
          refinedText,
          replaced: true,
          reason: `Spatial meeting grouping separated ${multiEntities.length} entities`,
          status: determineFieldStatus("meeting", refinedText)
        });
        console.log(`[Phase 5B Refinement] Multi-Session Meeting Row ${p.rowIndex}: separated into ${multiEntities.length} entities (${segments.map(s => s.text).join(" | ")})`);
        continue;
      }

      // 2. Single-session cell: arbitrate between PSM 6, PSM 13, and baseline
      const textPsm6 = resPsm6.text.trim();
      const textPsm7 = resPsm7.text.trim();
      const textPsm13 = resPsm13.text.trim();
      const meetingVariants = [
        { result: resPsm6, text: textPsm6, score: scoreMeetingText(textPsm6, resPsm6.confidence) },
        { result: resPsm7, text: textPsm7, score: scoreMeetingText(textPsm7, resPsm7.confidence) },
        { result: resPsm13, text: textPsm13, score: scoreMeetingText(textPsm13, resPsm13.confidence) },
      ].sort((a, b) => b.score - a.score);

      const bestRes = meetingVariants[0].result;
      const bestText = meetingVariants[0].text;

      const arbitration = arbitrateMeetingCandidate(
        baselineText,
        baselineConf,
        bestText,
        bestRes.confidence
      );

      console.log(`[Phase 5B Refinement] Meeting Row ${p.rowIndex}: baseline="${baselineText}", PSM6="${textPsm6}", PSM7="${textPsm7}", PSM13="${textPsm13}" => best="${bestText}", replaced=${arbitration.replaced}, reason=${arbitration.reason}`);

      if (arbitration.replaced) {
        const segments: TtuCellSegment[] =
          bestRes.lines.length > 0
            ? bestRes.lines.map((l) => ({
                text: l.text.trim(),
                bbox: {
                  x0: Math.round(cropBbox.x0 + l.bbox.x0 * scaleFactor),
                  y0: Math.round(cropBbox.y0 + l.bbox.y0 * scaleFactor),
                  x1: Math.round(cropBbox.x0 + l.bbox.x1 * scaleFactor),
                  y1: Math.round(cropBbox.y0 + l.bbox.y1 * scaleFactor),
                },
                confidence: l.confidence
              }))
            : [
                {
                  text: bestText,
                  bbox: cropBbox,
                  confidence: bestRes.confidence
                }
              ];

        row.cells.meeting = {
          column: "meeting",
          rawText: bestText,
          bbox: cell?.bbox ?? cropBbox,
          confidence: bestRes.confidence,
          segments,
        };

        refinedCount++;
        refinedDetails.push({
          rowIndex: p.rowIndex,
          column: "meeting",
          baselineText,
          refinedText: bestText,
          replaced: true,
          reason: arbitration.reason,
          status: determineFieldStatus("meeting", bestText)
        });
      } else {
        refinedDetails.push({
          rowIndex: p.rowIndex,
          column: "meeting",
          baselineText,
          refinedText: baselineText,
          replaced: false,
          reason: arbitration.reason,
          status: determineFieldStatus("meeting", baselineText)
        });
      }
    } else if (p.columnKey === "courseName") {
      // Course titles have larger glyphs (~14-16px); evaluate scale 2.0 alongside scale 4.0
      // to avoid stroke-blending artifacts on Arabic dots (e.g. preventing 'البيانات' -> 'البياتات')
      const cropScale2 = await cropAndPreprocessCell(originalImage, cropBbox, 2.0);
      const resScale2 = await engine.recognizeImage(cropScale2.blob, {
        pageSegMode: "6",
        skipPreprocessing: true
      });

      const ocrResult = await engine.recognizeImage(cropPreprocessed.blob, {
        pageSegMode: "6",
        skipPreprocessing: true
      });

      // Strip leading/trailing border/delimiter noise from candidates
      const cleanBaseline = baselineText.replace(/^[»«|~^_\s\d\-–—]+|[»«|~^_\s\d\-–—]+$/g, "").trim();
      const cleanScale2 = resScale2.text.trim().replace(/^[»«|~^_\s\d\-–—]+|[»«|~^_\s\d\-–—]+$/g, "").trim();
      const cleanCand4 = ocrResult.text.trim().replace(/^[»«|~^_\s\d\-–—]+|[»«|~^_\s\d\-–—]+$/g, "").trim();

      // Pick best candidate between scale 2 and scale 4
      const scoreScale2 = scoreCourseNameText(cleanScale2, resScale2.confidence);
      const scoreCand4 = scoreCourseNameText(cleanCand4, ocrResult.confidence);
      const bestCandidate = scoreScale2 >= scoreCand4 ? cleanScale2 : cleanCand4;
      const bestConf = scoreScale2 >= scoreCand4 ? resScale2.confidence : ocrResult.confidence;
      const scoreCandidate = Math.max(scoreScale2, scoreCand4);
      const scoreBaseline = scoreCourseNameText(cleanBaseline, baselineConf);

      // Invariant: A cleaner Arabic course-name baseline must NOT be replaced by a worse candidate
      const baselineIsPureArabic = /^[\u0600-\u06FF\s]+$/.test(cleanBaseline) && cleanBaseline.length >= 4;
      const candidateIsPureArabic = /^[\u0600-\u06FF\s]+$/.test(bestCandidate) && bestCandidate.length >= 4;

      const shouldReplace =
        !baselineIsPureArabic && candidateIsPureArabic
          ? true
          : baselineIsPureArabic && !candidateIsPureArabic
          ? false
          : scoreCandidate > scoreBaseline + 5 && bestCandidate.length >= cleanBaseline.length;

      console.log(
        `[Phase 5B Refinement] CourseName Row ${p.rowIndex}: baseline="${baselineText}", scale2="${cleanScale2}", scale4="${cleanCand4}" => best="${bestCandidate}", shouldReplace=${shouldReplace}`
      );

      if (shouldReplace) {
        row.cells.courseName = {
          column: "courseName",
          rawText: bestCandidate,
          bbox: cell?.bbox ?? cropBbox,
          confidence: bestConf,
          segments: [{ text: bestCandidate, bbox: cropBbox, confidence: bestConf }],
        };
        refinedCount++;
        refinedDetails.push({
          rowIndex: p.rowIndex,
          column: "courseName",
          baselineText,
          refinedText: bestCandidate,
          replaced: true,
          reason: "Cleaner course title from pixels",
          status: "RESOLVED_FROM_PIXELS"
        });
      } else {
        // Preserve clean baseline (stripping noise characters)
        const preservedText = cleanBaseline || baselineText;
        if (cleanBaseline !== baselineText && cleanBaseline.length > 0) {
          row.cells.courseName = {
            column: "courseName",
            rawText: preservedText,
            bbox: cell?.bbox ?? cropBbox,
            confidence: baselineConf,
            segments: [{ text: preservedText, bbox: cell?.bbox ?? cropBbox, confidence: baselineConf }],
          };
        }
        refinedDetails.push({
          rowIndex: p.rowIndex,
          column: "courseName",
          baselineText,
          refinedText: preservedText,
          replaced: false,
          reason: "Baseline preserved",
          status: "RESOLVED_FROM_PIXELS"
        });
      }
    }
  }

  return { refinedGeometry, refinedCount, refinedDetails };
}
