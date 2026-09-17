import type { AcademicTerm, ClassSession, Course, DayCode, AcademicCalendar, AcademicCalendarEvent } from "./models";
import { AcademicCalendarSchema } from "./models";
import { dayNames } from "./schedule";

const dayToJsWeekday: Record<DayCode, number> = {
  ح: 0,
  ن: 1,
  ث: 2,
  ر: 3,
  خ: 4,
  س: 6
};

export function getFirstOccurrenceDate(termStartsOn: string, day: DayCode): string {
  const [y, m, d] = termStartsOn.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const currentDay = dt.getUTCDay();
  const targetDay = dayToJsWeekday[day];
  const diff = (targetDay - currentDay + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() + diff);
  const year = dt.getUTCFullYear();
  const month = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
  const date = dt.getUTCDate().toString().padStart(2, "0");
  return `${year}${month}${date}`;
}

const icsDate = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function generateIcs(courses: Course[], sessions: ClassSession[], term: AcademicTerm): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Murattab//AR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-TIMEZONE:Asia/Amman"
  ];

  for (const session of sessions) {
    const course = courses.find((item) => item.id === session.courseId);
    if (!course) continue;

    const firstDate = getFirstOccurrenceDate(term.startsOn, session.day);
    const startCompact = session.startsAt.replace(":", "");
    const endCompact = session.endsAt.replace(":", "");
    const untilDate = term.endsOn.replaceAll("-", "");
    const kindLabel = session.kind === "lecture" ? "نظري" : session.kind === "lab" ? "عملي" : "غير محدد";

    lines.push(
      "BEGIN:VEVENT",
      `UID:${session.id}@murattab`,
      `SUMMARY:${course.name}`,
      `DESCRIPTION:نوع الجلسة: ${kindLabel}\\nالقاعة: ${session.room.label}`,
      `LOCATION:${session.room.label}`,
      `DTSTART;TZID=Asia/Amman:${firstDate}T${startCompact}00`,
      `DTEND;TZID=Asia/Amman:${firstDate}T${endCompact}00`,
      `RRULE:FREQ=WEEKLY;UNTIL=${untilDate}T235959Z`,
      `URL:https://murattab.local/course/${course.id}`,
      `X-MURATTAB-DAY:${dayNames[session.day]}`
    );

    if (course.reminder.enabled && course.reminder.minutesBefore >= 0) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:تذكير بمحاضرة ${course.name}`,
        `TRIGGER:-PT${course.reminder.minutesBefore}M`,
        "END:VALARM"
      );
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function generateCourseIcs(course: Course, sessions: ClassSession[], term: AcademicTerm): string {
  const matched = sessions.filter((s) => s.courseId === course.id);
  return generateIcs([course], matched, term);
}

export { icsDate };

/**
 * Academic calendar helpers — used to render the official TTU calendar
 * in the Calendar UI alongside the student's recurring class sessions.
 *
 * The official calendar is loaded synchronously from a typed module that
 * re-exports `data/academic-calendars/ttu/2026-2027/first/calendar.json`.
 * No network call. Works fully offline.
 */
export { ttuAcademicCalendar } from "./ttu-academic-calendar";

/** Returns all events that intersect the given date (YYYY-MM-DD). */
export function getEventsOnDate(
  events: ReadonlyArray<AcademicCalendarEvent>,
  isoDate: string
): AcademicCalendarEvent[] {
  return events.filter((e) => {
    const end = e.endsOn ?? e.startsOn;
    return isoDate >= e.startsOn && isoDate <= end;
  });
}

/** Returns the first event (by start date) at or after the given date, if any. */
export function getNextEvent(events: ReadonlyArray<AcademicCalendarEvent>, isoDate: string): AcademicCalendarEvent | undefined {
  return [...events].sort((a, b) => a.startsOn.localeCompare(b.startsOn)).find((e) => e.startsOn >= isoDate);
}


