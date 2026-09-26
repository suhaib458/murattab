import { AcademicCalendarSchema, type AcademicCalendar } from "@/domain/models";
import { ttuAcademicCalendar } from "@/domain/ttu-academic-calendar";
import type { TtuCalendarEnvelope } from "@/domain/ttu-api";
import { fetchTtuApiJson } from "@/server/ttu-api/client";
import {
  isTtuCalendarApiConfigured,
  readTtuApiConfig,
  type TtuApiConfig
} from "@/server/ttu-api/config";

type CalendarCache = {
  expiresAt: number;
  calendar: AcademicCalendar;
};

let liveCalendarCache: CalendarCache | null = null;

function extractCalendarCandidate(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [payload];
  const record = payload as Record<string, unknown>;
  return [payload, record.calendar, record.data].filter((candidate) => candidate !== undefined);
}

/**
 * This adapter intentionally validates against Murattab's normalized calendar
 * contract. Once TTU publishes official API docs, any university-specific
 * field mapping belongs here instead of leaking into the UI.
 */
export function normalizeTtuCalendarPayload(payload: unknown): AcademicCalendar {
  for (const candidate of extractCalendarCandidate(payload)) {
    const parsed = AcademicCalendarSchema.safeParse(candidate);
    if (parsed.success && parsed.data.universityId === "ttu") return parsed.data;
  }

  throw new Error("TTU API calendar payload does not match Murattab's normalized schema");
}

function localEnvelope(apiConfigured: boolean, fallbackReason: string | null): TtuCalendarEnvelope {
  return {
    calendar: ttuAcademicCalendar,
    meta: {
      source: "local-static",
      fetchedAt: new Date().toISOString(),
      apiConfigured,
      fallbackReason
    }
  };
}

export async function resolveTtuAcademicCalendar(options: {
  config?: TtuApiConfig;
  fetchImpl?: typeof fetch;
  now?: number;
} = {}): Promise<TtuCalendarEnvelope> {
  const config = options.config ?? readTtuApiConfig();
  const now = options.now ?? Date.now();
  const configured = isTtuCalendarApiConfigured(config);

  if (!configured) {
    return localEnvelope(false, config.enabled ? "calendar-endpoint-not-configured" : "api-disabled");
  }

  if (liveCalendarCache && liveCalendarCache.expiresAt > now) {
    return {
      calendar: liveCalendarCache.calendar,
      meta: {
        source: "official-api",
        fetchedAt: new Date().toISOString(),
        apiConfigured: true,
        fallbackReason: null
      }
    };
  }

  try {
    const payload = await fetchTtuApiJson(config, config.calendarPath!, options.fetchImpl);
    const calendar = normalizeTtuCalendarPayload(payload);

    liveCalendarCache = {
      calendar,
      expiresAt: now + config.cacheTtlMs
    };

    return {
      calendar,
      meta: {
        source: "official-api",
        fetchedAt: new Date().toISOString(),
        apiConfigured: true,
        fallbackReason: null
      }
    };
  } catch (error) {
    console.warn("[TTU API] Calendar fallback to bundled data:", error);
    return localEnvelope(true, "official-api-unavailable");
  }
}

export function resetTtuAcademicCalendarCacheForTests(): void {
  liveCalendarCache = null;
}
