import { expandRoom, getIctLabLabel } from "@/domain/schedule";
import {
  ScheduleExtractionResultSchema,
  type ScheduleExtractionResult
} from "@/domain/models";
import type {
  TtuCourseSection,
  TtuStudentSchedule,
  TtuStudentScheduleCourse
} from "@/domain/ttu-api";
import { generateId } from "@/lib/uuid";

function normalizedRoom(roomRaw: string, kind: "lecture" | "lab" | "unspecified"): string | undefined {
  const ict = getIctLabLabel(roomRaw, kind);
  if (ict) return ict;

  const expanded = expandRoom(roomRaw);
  return expanded.label !== roomRaw ? expanded.label : undefined;
}

function courseToDraft(
  course: TtuStudentScheduleCourse,
  confidence: Record<string, number>
) {
  const courseId = generateId();
  confidence[`course_${courseId}_name`] = 1;

  return {
    name: course.name,
    sessions: course.sessions.map((session) => {
      const sessionId = generateId();
      confidence[`session_${sessionId}_day`] = 1;
      confidence[`session_${sessionId}_time`] = 1;
      confidence[`session_${sessionId}_room`] = 1;

      return {
        id: sessionId,
        courseId,
        day: session.day,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        roomRaw: session.room,
        roomExpanded: normalizedRoom(session.room, session.kind),
        kind: session.kind
      };
    })
  };
}

/**
 * Converts an official TTU student schedule into Murattab's existing review
 * contract. Nothing is persisted automatically: the same review/approve flow
 * used by Smart Import can be reused later.
 */
export function ttuStudentScheduleToExtractionResult(
  schedule: TtuStudentSchedule
): ScheduleExtractionResult {
  const confidence: Record<string, number> = {};
  const courses = schedule.courses.map((course) => courseToDraft(course, confidence));

  return ScheduleExtractionResultSchema.parse({
    draft: {
      courses,
      issues: []
    },
    confidence
  });
}

/**
 * Converts one official catalog section into the same review contract so a
 * future "add this section" action can reuse today's safe schedule import UI.
 */
export function ttuCatalogSectionToExtractionResult(input: {
  courseName: string;
  section: TtuCourseSection;
}): ScheduleExtractionResult {
  const confidence: Record<string, number> = {};
  const pseudoCourse: TtuStudentScheduleCourse = {
    code: "catalog-selection",
    name: input.courseName,
    sectionId: input.section.id,
    sectionNumber: input.section.number,
    instructorName: input.section.instructorName,
    sessions: input.section.sessions
  };

  return ScheduleExtractionResultSchema.parse({
    draft: {
      courses: [courseToDraft(pseudoCourse, confidence)],
      issues: []
    },
    confidence
  });
}
