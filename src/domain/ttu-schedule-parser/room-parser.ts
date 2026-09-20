/**
 * Murattab TTU Schedule Room Parser.
 *
 * Deterministically parses, preserves, and optionally expands room locations
 * using verified TTU building rules.
 *
 * Rules:
 * - Always preserves roomRaw from geometry.
 * - Reuses verified expandRoom() for "م", "هـ/ه", "ع" buildings.
 * - Reuses getIctLabLabel() for verified ICT computer lab patterns (e.g. ICT - 4).
 * - Leaves unexpanded valid rooms (e.g. DS-ICT 2, DS-ICT 3) as valid raw evidence
 *   without emitting ROOM_UNRESOLVED.
 * - Emits ROOM_MISSING only when no room text exists.
 * - Emits ROOM_UNRESOLVED only when room text is corrupted noise/punctuation.
 */

import { expandRoom, getIctLabLabel } from "@/domain/schedule";
import type { TtuSemanticIssue } from "./types";

export interface RoomParseResult {
  /** Preserved raw room string. */
  roomRaw: string;
  /** Expanded room label if recognized by TTU rules, else undefined. */
  roomExpanded?: string;
  /** Room extraction confidence bounded by source geometry confidence (0–1). */
  confidence: number;
  /** Diagnostic issues encountered. */
  issues: TtuSemanticIssue[];
}

/**
 * Parses and optionally expands a room text segment.
 *
 * @param rawText - Raw text from the room segment or cell
 * @param sourceConfidence - Bounding confidence from geometry (0–1)
 * @param sessionKind - Inferred or default session kind ("lecture" | "lab" | "unspecified")
 * @param courseName - Optional course name for diagnostic reporting
 */
export function parseTtuRoom(
  rawText: string | undefined,
  sourceConfidence = 1.0,
  sessionKind: "lecture" | "lab" | "unspecified" = "unspecified",
  courseName?: string
): RoomParseResult {
  const issues: TtuSemanticIssue[] = [];
  const clean = (rawText ?? "").trim().replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "");

  if (!clean) {
    issues.push({
      code: "ROOM_MISSING",
      message: `لم تظهر قاعة واضحة للمحاضرة${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "warning",
      courseName
    });
    return {
      roomRaw: "",
      confidence: 0,
      issues
    };
  }

  // Check if the room text is just corrupted noise/punctuation (e.g. "@", "?", "...")
  if (/^[^a-zA-Z0-9\u0600-\u06FF]+$/.test(clean) && clean.length < 4) {
    issues.push({
      code: "ROOM_UNRESOLVED",
      message: `نص القاعة "${clean}" غير مقروء أو غير صالح${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "warning",
      courseName
    });
    return {
      roomRaw: clean,
      confidence: Math.min(sourceConfidence, 0.4),
      issues
    };
  }

  // 1. Check verified expandRoom helper from domain
  const expanded = expandRoom(clean);
  let roomExpanded: string | undefined = expanded.label !== clean ? expanded.label : undefined;

  // 2. Check verified ICT lab label if kind is lab or if matches plain ICT lab
  if (!roomExpanded) {
    const ictLabel = getIctLabLabel(clean, "lab");
    if (ictLabel) {
      roomExpanded = ictLabel;
    }
  }

  // Confidence is bounded by source geometry confidence
  const confidence = roomExpanded
    ? Math.min(sourceConfidence, 0.95)
    : Math.min(sourceConfidence, 0.88);

  return {
    roomRaw: clean,
    roomExpanded,
    confidence,
    issues
  };
}
