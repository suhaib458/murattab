/**
 * Typed re-export of the official TTU 2026/2027 first-semester academic calendar.
 *
 * Canonical file: data/academic-calendars/ttu/2026-2027/first/calendar.json
 * (validated by `pnpm calendar:validate` and `pnpm data:validate`)
 *
 * At runtime, the data is consumed from this typed module so it ships with
 * the client bundle and works fully offline. There is NO network fetch
 * to TTU or any other service.
 */
import raw from "../../data/academic-calendars/ttu/2026-2027/first/calendar.json";
import { AcademicCalendarSchema, type AcademicCalendar } from "./models";

const parsed = AcademicCalendarSchema.safeParse(raw);
if (!parsed.success) {
  // This is a build-time invariant. If the JSON file is malformed, fail loudly
  // so the developer notices — `pnpm data:validate` and `pnpm calendar:validate`
  // will also flag the same issues.
  throw new Error(
    `Official TTU academic calendar failed schema validation: ${JSON.stringify(parsed.error.issues)}`
  );
}

export const ttuAcademicCalendar: AcademicCalendar = parsed.data;
