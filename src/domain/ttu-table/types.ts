/**
 * Murattab TTU Table Geometry Types.
 *
 * Defines the deterministic spatial contract for extracted TTU schedule tables.
 * All coordinates are in the ORIGINAL image coordinate system.
 *
 * No semantic interpretation (e.g. day decoding or time parsing) is performed here —
 * this module represents structural geometry only.
 */

import type { OcrBoundingBox } from "@/domain/ocr/types";

// ── Column Identification ──────────────────────────────────────────────

export type TtuColumnKey =
  | "courseName"
  | "section"
  | "creditHours"
  | "meeting"
  | "room"
  | "unknown";

export interface TtuTableColumn {
  key: TtuColumnKey;
  /** Raw text of the detected header anchor. */
  headerText: string;
  /** Bounding box of the header text in original image coordinates. */
  bbox: OcrBoundingBox;
  /** Left boundary of the column's horizontal span. */
  xStart: number;
  /** Right boundary of the column's horizontal span. */
  xEnd: number;
  /** Confidence of header detection (0–1). */
  confidence: number;
}

// ── Cell & Segment Geometry ────────────────────────────────────────────

/**
 * A single visual line segment within a cell.
 * E.g., for a multi-session course row, a meeting cell might contain
 * segment 0 ("ح ث خ 10:00 - 11:00") and segment 1 ("ن 08:30 - 10:30").
 */
export interface TtuCellSegment {
  /** Raw text of this segment. */
  text: string;
  /** Bounding box of this segment in original image coordinates. */
  bbox: OcrBoundingBox;
  /** Confidence score (0–1). */
  confidence: number;
}

/**
 * A cell inside a table row corresponding to a specific column.
 */
export interface TtuTableCell {
  column: TtuColumnKey;
  /**
   * Complete raw text of the cell.
   * Multiple segments are joined with newline (`\n`).
   */
  rawText: string;
  /** Ordered segments from top to bottom. */
  segments: TtuCellSegment[];
  /** Bounding box enclosing all segments in this cell, or null if empty. */
  bbox: OcrBoundingBox | null;
  /** Overall confidence for this cell (0–1). */
  confidence: number;
}

// ── Row Geometry ───────────────────────────────────────────────────────

/**
 * A logical schedule row representing one course entry.
 * Even if a course has multiple meeting or room lines (lecture + lab),
 * it constitutes ONE TtuTableRow.
 */
export interface TtuTableRow {
  /** Zero-based index of the row from top to bottom. */
  index: number;
  /** Bounding box enclosing all cells in this row. */
  bbox: OcrBoundingBox;
  /** Cells indexed by column key. */
  cells: Partial<Record<TtuColumnKey, TtuTableCell>>;
  /** Row-level confidence score (0–1). */
  confidence: number;
}

// ── Diagnostic Issues ──────────────────────────────────────────────────

export type TtuParseIssueCode =
  | "HEADER_NOT_FOUND"
  | "HEADER_PARTIAL"
  | "COLUMN_GEOMETRY_AMBIGUOUS"
  | "ROW_AMBIGUOUS"
  | "CELL_ASSIGNMENT_AMBIGUOUS"
  | "COURSE_NAME_MISSING"
  | "MEETING_CELL_EMPTY"
  | "ROOM_CELL_EMPTY"
  | "FOOTER_DETECTED"
  | "IMAGE_TOO_FEW_TOKENS"
  | "NO_ROWS_DETECTED";

export interface TtuTableParseIssue {
  code: TtuParseIssueCode | string;
  message: string;
  severity: "info" | "warning" | "error";
  rowIndex?: number;
  column?: TtuColumnKey;
}

// ── Complete Result ────────────────────────────────────────────────────

export interface TtuTableGeometryResult {
  /** Identified table columns ordered physically from left to right (x0 ascending). */
  columns: TtuTableColumn[];
  /** Parsed rows ordered from top to bottom (y0 ascending). */
  rows: TtuTableRow[];
  /** Structured warnings, errors, or diagnostic issues encountered. */
  issues: TtuTableParseIssue[];
  /** Overall geometry extraction confidence (0–1). */
  confidence: number;
}
