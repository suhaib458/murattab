import type { DayCode, AcademicCalendarEvent } from "./models";

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


