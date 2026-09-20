/**
 * Murattab TTU Schedule Room Parser.
 *
 * Deterministically parses, preserves, and optionally expands room locations
 * using verified TTU room grammar.
 *
 * Non-guessing invariant:
 * - A room is considered resolved only when its ENTIRE text matches a verified
 *   TTU room form.
 * - Prefix/suffix garbage is never ignored.
 * - Corrupted OCR such as "مختبر الحاسوب 5 161 ف",
 *   "acd محوسبة 3 DS-ICT", or "قاعة محوسبة 3 05-167" remains unresolved.
 */

import { expandRoom, getIctLabLabel } from "@/domain/schedule";
import type { TtuSemanticIssue } from "./types";

export interface RoomParseResult {
  roomRaw: string;
  roomExpanded?: string;
  confidence: number;
  issues: TtuSemanticIssue[];
}

function normalizeRoomText(rawText: string | undefined): string {
  return (rawText ?? "")
    .trim()
    .replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "")
    .replace(/\s+/g, " ");
}

function isOnlineRoom(clean: string): boolean {
  return /^(Online|أونلاين|عبر الإنترنت)$/i.test(clean);
}

function isBuildingCodeRoom(clean: string): boolean {
  return (
    /^(?:م|ع|هـ|ه)\s*\d{1,4}$/.test(clean) ||
    /^\d{1,4}\s*(?:م|ع|هـ|ه)$/.test(clean)
  );
}

function isNamedHallRoom(clean: string): boolean {
  return /^(?:قاعة|مدرج)\s+\d{1,4}$/.test(clean);
}

function isComputerizedHallRoom(clean: string): boolean {
  return /^قاعة\s+محوسبة\s+\d+(?:\s+DS-ICT(?:\s*[-–—]?\s*\d+)?)?$/i.test(clean);
}

function isDsIctRoom(clean: string): boolean {
  return /^DS-ICT\s*[-–—]?\s*\d+$/i.test(clean);
}

function isPlainIctLab(clean: string): boolean {
  return /^ICT\s*[-–—]?\s*\d+$/i.test(clean);
}

function isExplicitIctLab(clean: string): boolean {
  return (
    /^مختبر\s+الحاسوب\s+ICT\s*[-–—]?\s*\d+$/i.test(clean) ||
    /^مختبر\s+الحاسوب\s+\d+\s+ICT$/i.test(clean)
  );
}

/**
 * Single strict verifier used by semantic parsing and OCR refinement.
 * It validates the complete room string; partial matches are not enough.
 */
export function isVerifiedTtuRoomText(rawText: string | undefined): boolean {
  const clean = normalizeRoomText(rawText);
  if (!clean) return false;

  return (
    isOnlineRoom(clean) ||
    isBuildingCodeRoom(clean) ||
    isNamedHallRoom(clean) ||
    isComputerizedHallRoom(clean) ||
    isDsIctRoom(clean) ||
    isPlainIctLab(clean) ||
    isExplicitIctLab(clean)
  );
}

/**
 * Parses and optionally expands a room text segment.
 */
export function parseTtuRoom(
  rawText: string | undefined,
  sourceConfidence = 1.0,
  sessionKind: "lecture" | "lab" | "unspecified" = "unspecified",
  courseName?: string
): RoomParseResult {
  const issues: TtuSemanticIssue[] = [];
  const clean = normalizeRoomText(rawText);

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

  if (!isVerifiedTtuRoomText(clean)) {
    issues.push({
      code: "ROOM_UNRESOLVED",
      message: `نص القاعة "${clean}" غير مؤكد أو يحتوي قراءة OCR غير موثوقة${courseName ? ` لمادة "${courseName}"` : ""}.`,
      severity: "warning",
      courseName
    });
    return {
      roomRaw: clean,
      confidence: Math.min(sourceConfidence, 0.35),
      issues
    };
  }

  let roomExpanded: string | undefined;

  if (isOnlineRoom(clean)) {
    roomExpanded = "عبر الإنترنت";
  } else if (isBuildingCodeRoom(clean)) {
    const expanded = expandRoom(clean);
    roomExpanded = expanded.label !== clean ? expanded.label : undefined;
  } else if (isPlainIctLab(clean)) {
    roomExpanded = getIctLabLabel(clean, "lab") ?? undefined;
  } else if (isExplicitIctLab(clean)) {
    // The raw string is already the human-readable official lab form.
    roomExpanded = undefined;
  } else if (sessionKind === "lab" && /^ICT/i.test(clean)) {
    roomExpanded = getIctLabLabel(clean, "lab") ?? undefined;
  }

  return {
    roomRaw: clean,
    roomExpanded,
    confidence: Math.min(sourceConfidence, 0.95),
    issues
  };
}
