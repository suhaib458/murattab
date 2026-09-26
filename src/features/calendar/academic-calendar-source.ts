import { AcademicCalendarSchema, type AcademicCalendar } from "@/domain/models";
import { ttuAcademicCalendar } from "@/domain/ttu-academic-calendar";
import { TtuCalendarEnvelopeSchema } from "@/domain/ttu-api";

const CLIENT_REFRESH_MS = 15 * 60_000;

let lastResolved: {
  at: number;
  calendar: AcademicCalendar;
} | null = null;

/**
 * The bundled official calendar is always the immediate/offline fallback.
 * When an authorized TTU API is configured server-side, this function can
 * replace it at runtime without exposing university credentials to the client.
 */
export async function getPreferredAcademicCalendar(options: {
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: number;
} = {}): Promise<AcademicCalendar> {
  const now = options.now ?? Date.now();
  if (!options.force && lastResolved && now - lastResolved.at < CLIENT_REFRESH_MS) {
    return lastResolved.calendar;
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl("/api/ttu/calendar", {
      method: "GET",
      headers: { "x-murattab-client": "web" },
      cache: "no-store"
    });

    if (!response.ok) return ttuAcademicCalendar;

    const envelope = TtuCalendarEnvelopeSchema.safeParse(await response.json());
    if (!envelope.success) return ttuAcademicCalendar;

    const parsed = AcademicCalendarSchema.safeParse(envelope.data.calendar);
    if (!parsed.success || parsed.data.universityId !== "ttu") return ttuAcademicCalendar;

    lastResolved = { at: now, calendar: parsed.data };
    return parsed.data;
  } catch {
    return ttuAcademicCalendar;
  }
}

export function resetAcademicCalendarSourceForTests(): void {
  lastResolved = null;
}
