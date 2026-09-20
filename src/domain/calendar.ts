import type { DayCode, AcademicCalendarEvent, AcademicTerm, ClassSession, Course } from "./models";

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




const jsWeekdayToDayCode: Partial<Record<number, DayCode>> = {
  0: "ح",
  1: "ن",
  2: "ث",
  3: "ر",
  4: "خ",
  6: "س"
};

/**
 * Returns true when an ISO calendar date belongs to the teaching bounds
 * of the supplied academic term. Bounds are inclusive.
 */
export function isDateWithinAcademicTerm(isoDate: string, term: AcademicTerm): boolean {
  return isoDate >= term.startsOn && isoDate <= term.endsOn;
}

/**
 * Resolve the student's recurring weekly sessions for one concrete calendar date.
 *
 * Critical invariant:
 * A ClassSession is only a weekly pattern. It does NOT recur forever.
 * Its concrete occurrences are bounded by the AcademicTerm of its Course.
 */
export function getSessionsOnAcademicDate(
  sessions: ReadonlyArray<ClassSession>,
  courses: ReadonlyArray<Course>,
  terms: ReadonlyArray<AcademicTerm>,
  isoDate: string
): ClassSession[] {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return [];

  const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dayCode = jsWeekdayToDayCode[jsDay];
  if (!dayCode) return [];

  const courseById = new Map(courses.map((course) => [course.id, course]));
  const termById = new Map(terms.map((term) => [term.id, term]));

  return sessions.filter((session) => {
    if (session.day !== dayCode) return false;

    const course = courseById.get(session.courseId);
    if (!course) return false;

    const term = termById.get(course.termId);
    if (!term) return false;

    return isDateWithinAcademicTerm(isoDate, term);
  });
}

export interface NextAcademicSession {
  session: ClassSession;
  date: string;
  daysAhead: number;
}

/**
 * Finds the next concrete class occurrence from a real calendar date.
 * Unlike the legacy weekly helper, this never wraps recurring classes
 * beyond their academic-term end date.
 */
export function getNextAcademicSession(
  sessions: ReadonlyArray<ClassSession>,
  courses: ReadonlyArray<Course>,
  terms: ReadonlyArray<AcademicTerm>,
  fromDate: Date,
  nowTime: string
): NextAcademicSession | null {
  if (sessions.length === 0 || courses.length === 0 || terms.length === 0) return null;

  const latestTermEnd = terms.reduce(
    (latest, term) => (term.endsOn > latest ? term.endsOn : latest),
    terms[0].endsOn
  );

  const cursor = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());

  for (let offset = 0; offset <= 370; offset++) {
    const isoDate = [
      cursor.getFullYear(),
      String(cursor.getMonth() + 1).padStart(2, "0"),
      String(cursor.getDate()).padStart(2, "0")
    ].join("-");

    if (isoDate > latestTermEnd) break;

    const daySessions = getSessionsOnAcademicDate(sessions, courses, terms, isoDate)
      .slice()
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

    const candidate =
      offset === 0
        ? daySessions.find((session) => session.startsAt > nowTime)
        : daySessions[0];

    if (candidate) {
      return { session: candidate, date: isoDate, daysAhead: offset };
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return null;
}
