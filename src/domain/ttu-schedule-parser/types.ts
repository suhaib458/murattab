/**
 * Murattab TTU Schedule Semantic Parser Types.
 *
 * Defines the deterministic semantic contract for schedule courses and sessions
 * extracted from Phase 2 TtuTableGeometryResult.
 *
 * Pure domain representations only. No UUIDs, no AI, no guessing.
 */

import type { DayCode } from "@/domain/models";

export type TtuSemanticIssueCode =
  | "COURSE_NAME_MISSING"
  | "DAY_UNRESOLVED"
  | "DAY_TOKEN_AMBIGUOUS"
  | "TIME_RANGE_MISSING"
  | "INVALID_TIME_RANGE"
  | "ROOM_MISSING"
  | "ROOM_UNRESOLVED"
  | "SEGMENT_PAIRING_AMBIGUOUS"
  | "EXTRA_ROOM_SEGMENT"
  | "EXTRA_MEETING_SEGMENT"
  | "SESSION_KIND_UNSPECIFIED";

export interface TtuSemanticIssue {
  code: TtuSemanticIssueCode;
  message: string;
  severity: "info" | "warning" | "error";
  courseName?: string;
  rowIndex?: number;
  sessionIndex?: number;
}

export interface TtuSessionConfidence {
  day: number;
  time: number;
  room: number;
  pairing: number;
}

export interface TtuParsedSession {
  /** Canonical single-letter day code (س, ح, ن, ث, ر, خ), or null if unresolved. */
  day: DayCode | null;
  /** 24-hour start time (HH:mm), or null if unresolved. */
  startsAt: string | null;
  /** 24-hour end time (HH:mm), or null if unresolved. */
  endsAt: string | null;
  /** Preserved raw room string from geometry. */
  roomRaw: string;
  /** Verified expanded room label if recognized by TTU rules, else undefined. */
  roomExpanded?: string;
  /** Session type based on deterministic evidence. */
  kind: "lecture" | "lab" | "unspecified";
  /** Raw segment source text for auditing and user review. */
  source: {
    meetingSegmentText: string;
    roomSegmentText?: string;
  };
  /** Source-bounded confidence scores for each component. */
  confidence: TtuSessionConfidence;
}

export interface TtuParsedCourse {
  /** Normalized course title. */
  courseName: string;
  /** Original raw text from courseName cell. */
  rawCourseName: string;
  /** Raw section cell text if available. */
  sectionRaw?: string;
  /** Raw credit hours text if available. */
  creditHoursRaw?: string;
  /** Individual day-expanded class sessions. */
  sessions: TtuParsedSession[];
  /** Overall course extraction confidence score (0–1). */
  confidence: number;
}

export interface TtuParsedSchedule {
  /** Parsed course schedule. */
  courses: TtuParsedCourse[];
  /** Semantic issues and diagnostics. */
  issues: TtuSemanticIssue[];
  /** Overall schedule extraction confidence score (0–1). */
  confidence: number;
}
