/**
 * Murattab TTU Schedule Semantic Parser.
 *
 * Orchestrates deterministic semantic extraction from Phase 2 TtuTableGeometryResult.
 *
 * Guaranteed Invariants:
 * - 100% Deterministic (pure functions, no UUIDs or random IDs in semantic output).
 * - Zero AI calls, zero external APIs.
 * - Source-bounded confidence scoring.
 * - Non-guessing (unresolved days/times/rooms remain null or empty without silent fallback).
 */

import type { TtuTableGeometryResult, TtuTableRow } from "@/domain/ttu-table/types";
import type {
  TtuParsedCourse,
  TtuParsedSchedule,
  TtuParsedSession,
  TtuSemanticIssue
} from "./types";
import { parseTtuDayCodes } from "./day-parser";
import { parseTtuTimeRange } from "./time-parser";
import { parseTtuRoom } from "./room-parser";
import { pairMeetingAndRoomSegments } from "./segment-pairer";
import { classifySessionKind } from "./session-classifier";

/**
 * Normalizes course title by removing bidi controls and excessive whitespace.
 */
function cleanCourseName(raw: string): string {
  return raw
    .replace(/[\u200E\u200F\u202A-\u202E\u061C]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parses semantic TTU schedule data from table geometry.
 *
 * @param geometry - Structured table geometry from Phase 2
 */
export function parseTtuScheduleSemantics(geometry: TtuTableGeometryResult): TtuParsedSchedule {
  const issues: TtuSemanticIssue[] = [];
  const courses: TtuParsedCourse[] = [];

  for (let rIndex = 0; rIndex < geometry.rows.length; rIndex++) {
    const row: TtuTableRow = geometry.rows[rIndex];
    const courseCell = row.cells.courseName;
    const meetingCell = row.cells.meeting;
    const roomCell = row.cells.room;
    const sectionCell = row.cells.section;
    const creditCell = row.cells.creditHours;

    // 1. Course Name
    const rawCourseName = courseCell?.rawText ?? "";
    const courseName = cleanCourseName(rawCourseName);

    if (!courseName) {
      issues.push({
        code: "COURSE_NAME_MISSING",
        message: `اسم المادة في الصف رقم #${rIndex + 1} مفقود أو غير مقروء.`,
        severity: "error",
        rowIndex: rIndex
      });
    }

    // 2. Metadata (section, credit hours) preserved as raw
    const sectionRaw = sectionCell?.rawText ? cleanCourseName(sectionCell.rawText) : undefined;
    const creditHoursRaw = creditCell?.rawText ? cleanCourseName(creditCell.rawText) : undefined;

    // 3. Meeting & Room Segments
    const meetingSegments = meetingCell?.segments ?? [];
    const roomSegments = roomCell?.segments ?? [];

    // 4. Pair segments by vertical geometry
    const pairingResult = pairMeetingAndRoomSegments(
      meetingSegments,
      roomSegments,
      row.bbox,
      row.confidence,
      courseName
    );
    issues.push(...pairingResult.issues);

    const courseSessions: TtuParsedSession[] = [];

    // 5. Parse each paired segment
    for (let pIndex = 0; pIndex < pairingResult.pairs.length; pIndex++) {
      const pair = pairingResult.pairs[pIndex];
      const meetingText = pair.meetingSegment.text;
      const roomText = pair.roomSegment?.text;

      // Day parsing
      const dayResult = parseTtuDayCodes(meetingText, pair.meetingSegment.confidence, courseName);
      issues.push(...dayResult.issues);

      // Time parsing
      const timeResult = parseTtuTimeRange(meetingText, pair.meetingSegment.confidence, courseName);
      issues.push(...timeResult.issues);

      // Room parsing
      const roomResult = parseTtuRoom(
        roomText,
        pair.roomSegment?.confidence ?? 0,
        "unspecified",
        courseName
      );
      issues.push(...roomResult.issues);

      // Session classification
      const classification = classifySessionKind(
        roomResult.roomRaw,
        roomResult.roomExpanded,
        courseName
      );
      issues.push(...classification.issues);

      // Multi-day expansion: create one session per day
      if (dayResult.days.length > 0) {
        for (const day of dayResult.days) {
          courseSessions.push({
            day,
            startsAt: timeResult.startsAt,
            endsAt: timeResult.endsAt,
            roomRaw: roomResult.roomRaw,
            roomExpanded: roomResult.roomExpanded,
            kind: classification.kind,
            source: {
              meetingSegmentText: meetingText,
              roomSegmentText: roomText
            },
            confidence: {
              day: dayResult.confidence,
              time: timeResult.confidence,
              room: roomResult.confidence,
              pairing: pair.pairingConfidence
            }
          });
        }
      } else {
        // Unresolved day -> single session with day: null
        courseSessions.push({
          day: null,
          startsAt: timeResult.startsAt,
          endsAt: timeResult.endsAt,
          roomRaw: roomResult.roomRaw,
          roomExpanded: roomResult.roomExpanded,
          kind: classification.kind,
          source: {
            meetingSegmentText: meetingText,
            roomSegmentText: roomText
          },
          confidence: {
            day: 0,
            time: timeResult.confidence,
            room: roomResult.confidence,
            pairing: pair.pairingConfidence
          }
        });
      }
    }

    // Course Confidence: Bounded average of cell and session confidences
    const nameConfidence = courseName ? Math.min(courseCell?.confidence ?? 0.9, 0.95) : 0;
    let avgSessionConfidence = 0;
    if (courseSessions.length > 0) {
      const sum = courseSessions.reduce((acc, sess) => {
        const sConf = (sess.confidence.day + sess.confidence.time + sess.confidence.room + sess.confidence.pairing) / 4;
        return acc + sConf;
      }, 0);
      avgSessionConfidence = sum / courseSessions.length;
    }

    const courseConfidence = Number(
      (nameConfidence * 0.4 + avgSessionConfidence * 0.6).toFixed(3)
    );

    courses.push({
      courseName,
      rawCourseName,
      sectionRaw,
      creditHoursRaw,
      sessions: courseSessions,
      confidence: courseConfidence
    });
  }

  // Schedule Confidence: Bounded heuristic based on courses and error count
  let overallConfidence = 0;
  if (courses.length > 0) {
    const avgCourseConf = courses.reduce((acc, c) => acc + c.confidence, 0) / courses.length;
    const errorCount = issues.filter((i) => i.severity === "error").length;
    const penalty = Math.min(0.5, errorCount * 0.15);
    overallConfidence = Math.max(0, Number((avgCourseConf * (1 - penalty)).toFixed(3)));
  }

  return {
    courses,
    issues,
    confidence: overallConfidence
  };
}
