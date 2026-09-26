import { afterEach, describe, expect, it, vi } from "vitest";
import { ttuAcademicCalendar } from "@/domain/ttu-academic-calendar";
import {
  normalizeTtuCalendarPayload,
  resetTtuAcademicCalendarCacheForTests,
  resolveTtuAcademicCalendar
} from "@/server/ttu-api/calendar-service";
import { fetchTtuApiJson } from "@/server/ttu-api/client";
import { readTtuApiConfig, type TtuApiConfig } from "@/server/ttu-api/config";

const configured: TtuApiConfig = {
  enabled: true,
  baseUrl: "https://api.ttu.example/v1/",
  token: "secret-token",
  authHeader: "Authorization",
  authPrefix: "Bearer",
  timeoutMs: 5_000,
  cacheTtlMs: 15 * 60_000,
  calendarPath: "calendar/current",
  courseCatalogPath: null,
  studentSchedulePath: null
};

afterEach(() => {
  resetTtuAcademicCalendarCacheForTests();
  vi.restoreAllMocks();
});

describe("TTU API foundation", () => {
  it("keeps the bundled academic calendar when the official API is disabled", async () => {
    const result = await resolveTtuAcademicCalendar({
      config: { ...configured, enabled: false },
      now: 1
    });

    expect(result.calendar).toEqual(ttuAcademicCalendar);
    expect(result.meta.source).toBe("local-static");
    expect(result.meta.apiConfigured).toBe(false);
    expect(result.meta.fallbackReason).toBe("api-disabled");
  });

  it("uses a valid normalized official calendar when the API is configured", async () => {
    const official = {
      ...ttuAcademicCalendar,
      events: [
        ...ttuAcademicCalendar.events,
        {
          id: "ttu-live-test",
          title: "حدث رسمي مباشر",
          startsOn: "2026-11-01",
          kind: "other" as const
        }
      ]
    };

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: official }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as unknown as typeof fetch;

    const result = await resolveTtuAcademicCalendar({
      config: configured,
      fetchImpl,
      now: 100
    });

    expect(result.meta.source).toBe("official-api");
    expect(result.meta.apiConfigured).toBe(true);
    expect(result.meta.fallbackReason).toBeNull();
    expect(result.calendar.events.some((event) => event.id === "ttu-live-test")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("falls back safely when the official API returns an incompatible payload", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ unexpected: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as unknown as typeof fetch;

    const result = await resolveTtuAcademicCalendar({
      config: configured,
      fetchImpl,
      now: 100
    });

    expect(result.calendar).toEqual(ttuAcademicCalendar);
    expect(result.meta.source).toBe("local-static");
    expect(result.meta.apiConfigured).toBe(true);
    expect(result.meta.fallbackReason).toBe("official-api-unavailable");
  });

  it("accepts direct, calendar-wrapped, and data-wrapped normalized payloads", () => {
    expect(normalizeTtuCalendarPayload(ttuAcademicCalendar)).toEqual(ttuAcademicCalendar);
    expect(normalizeTtuCalendarPayload({ calendar: ttuAcademicCalendar })).toEqual(ttuAcademicCalendar);
    expect(normalizeTtuCalendarPayload({ data: ttuAcademicCalendar })).toEqual(ttuAcademicCalendar);
  });

  it("never sends the university token to another origin", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      fetchTtuApiJson(
        { ...configured, calendarPath: "https://evil.example/calendar" },
        "https://evil.example/calendar",
        fetchImpl
      )
    ).rejects.toMatchObject({ code: "INVALID_URL" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads TTU integration settings without enabling the API by default", () => {
    const config = readTtuApiConfig({
      TTU_API_BASE_URL: "https://api.ttu.example/",
      TTU_API_CALENDAR_PATH: "/calendar"
    } as NodeJS.ProcessEnv);

    expect(config.enabled).toBe(false);
    expect(config.baseUrl).toBe("https://api.ttu.example/");
    expect(config.calendarPath).toBe("/calendar");
    expect(config.authHeader).toBe("Authorization");
    expect(config.authPrefix).toBe("Bearer");
  });
});
