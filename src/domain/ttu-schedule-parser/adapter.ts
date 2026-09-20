/**
 * Murattab TTU Schedule Semantic Adapter.
 *
 * Converts a pure deterministic TtuParsedSchedule into the DraftCourse / DraftSession
 * contract expected by Murattab Smart Import (ScheduleExtractionResult).
 *
 * Guarantees:
 * - Generates unique session IDs only at the boundary.
 * - Preserves all semantic issues without loss.
 * - Does not replace null/unresolved fields with defaults.
 * - Conforms to ScheduleExtractionResultSchema.
 */

import { generateId } from "@/lib/uuid";
import type {
  DraftCourse,
  DraftSession,
  ExtractionIssue,
  ScheduleExtractionResult
} from "@/domain/models";
import { ScheduleExtractionResultSchema } from "@/domain/models";
import type { TtuParsedSchedule } from "./types";

/**
 * Converts pure TtuParsedSchedule into a validated ScheduleExtractionResult.
 *
 * @param parsed - Result from parseTtuScheduleSemantics()
 */
export function toScheduleExtractionResult(parsed: TtuParsedSchedule): ScheduleExtractionResult {
  const issues: ExtractionIssue[] = parsed.issues.map((issue) => ({
    field: issue.courseName ? `course_${issue.courseName}` : "schedule",
    message: issue.message,
    severity: issue.severity
  }));

  const confidenceRecord: Record<string, number> = {};
  const draftCourses: DraftCourse[] = [];

  for (let cIndex = 0; cIndex < parsed.courses.length; cIndex++) {
    const pCourse = parsed.courses[cIndex];
    const courseKey = `course_${cIndex}`;
    confidenceRecord[`${courseKey}_name`] = pCourse.confidence;

    const draftSessions: DraftSession[] = [];

    for (let sIndex = 0; sIndex < pCourse.sessions.length; sIndex++) {
      const pSess = pCourse.sessions[sIndex];
      const sessionId = generateId();

      confidenceRecord[`session_${sessionId}_day`] = pSess.confidence.day;
      confidenceRecord[`session_${sessionId}_time`] = pSess.confidence.time;
      confidenceRecord[`session_${sessionId}_room`] = pSess.confidence.room;
      confidenceRecord[`session_${sessionId}_pairing`] = pSess.confidence.pairing;

      draftSessions.push({
        id: sessionId,
        day: pSess.day,
        startsAt: pSess.startsAt,
        endsAt: pSess.endsAt,
        roomRaw: pSess.roomRaw,
        roomExpanded: pSess.roomExpanded,
        kind: pSess.kind
      });
    }

    draftCourses.push({
      name: pCourse.courseName,
      sessions: draftSessions
    });
  }

  const result: ScheduleExtractionResult = {
    draft: {
      courses: draftCourses,
      issues
    },
    confidence: confidenceRecord
  };

  // Ensure output contract matches existing domain schema
  return ScheduleExtractionResultSchema.parse(result);
}
