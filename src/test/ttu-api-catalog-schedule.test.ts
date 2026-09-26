import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TtuCourseCatalogSchema,
  TtuStudentScheduleSchema,
  type TtuCourseCatalog,
  type TtuStudentSchedule
} from "@/domain/ttu-api";
import {
  ttuCatalogSectionToExtractionResult,
  ttuStudentScheduleToExtractionResult
} from "@/domain/ttu-api-schedule-adapter";
import {
  normalizeTtuCourseCatalogPayload,
  resetTtuCourseCatalogCacheForTests,
  resolveTtuCourseCatalog
} from "@/server/ttu-api/course-catalog-service";
import {
  normalizeTtuStudentSchedulePayload,
  resolveTtuStudentSchedule
} from "@/server/ttu-api/student-schedule-service";
import type { TtuApiConfig } from "@/server/ttu-api/config";

const catalog: TtuCourseCatalog = TtuCourseCatalogSchema.parse({
  schemaVersion: 1,
  universityId: "ttu",
  academicYear: "2026/2027",
  term: "first",
  courses: [{
    code: "CS-301",
    name: "هياكل البيانات",
    creditHours: 3,
    sections: [{
      id: "12",
      number: "1",
      instructorName: "عضو هيئة تدريس",
      capacity: 40,
      enrolled: 32,
      sessions: [{
        day: "ح",
        startsAt: "09:00",
        endsAt: "10:00",
        room: "207 م",
        kind: "lecture"
      }]
    }]
  }]
});

const schedule: TtuStudentSchedule = TtuStudentScheduleSchema.parse({
  schemaVersion: 1,
  universityId: "ttu",
  academicYear: "2026/2027",
  term: "first",
  courses: [{
    code: "CS-301",
    name: "هياكل البيانات",
    sectionId: "12",
    sectionNumber: "1",
    instructorName: "عضو هيئة تدريس",
    creditHours: 3,
    sessions: [
      {
        day: "ح",
        startsAt: "09:00",
        endsAt: "10:00",
        room: "207 م",
        kind: "lecture"
      },
      {
        day: "ث",
        startsAt: "11:00",
        endsAt: "12:00",
        room: "ICT - 4",
        kind: "lab"
      }
    ]
  }]
});

const baseConfig: TtuApiConfig = {
  enabled: true,
  baseUrl: "https://api.ttu.example/v1/",
  token: "service-test-value",
  authHeader: "Authorization",
  authPrefix: "Bearer",
  timeoutMs: 5_000,
  cacheTtlMs: 15 * 60_000,
  calendarPath: "calendar/current",
  courseCatalogPath: "catalog/current",
  studentSchedulePath: "student/schedule",
  studentAuthMode: "delegated-bearer"
};

afterEach(() => {
  resetTtuCourseCatalogCacheForTests();
  vi.restoreAllMocks();
});

describe("TTU course catalog foundation", () => {
  it("accepts direct and wrapped normalized catalog payloads", () => {
    expect(normalizeTtuCourseCatalogPayload(catalog)).toEqual(catalog);
    expect(normalizeTtuCourseCatalogPayload({ catalog })).toEqual(catalog);
    expect(normalizeTtuCourseCatalogPayload({ data: catalog })).toEqual(catalog);
  });

  it("rejects invalid section times", () => {
    expect(() => normalizeTtuCourseCatalogPayload({
      ...catalog,
      courses: [{
        ...catalog.courses[0],
        sections: [{
          ...catalog.courses[0].sections[0],
          sessions: [{
            day: "ح",
            startsAt: "10:00",
            endsAt: "09:00",
            room: "207 م",
            kind: "lecture"
          }]
        }]
      }]
    })).toThrow();
  });

  it("caches the normalized catalog for the configured TTL", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: catalog }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as unknown as typeof fetch;

    const first = await resolveTtuCourseCatalog({ config: baseConfig, fetchImpl, now: 100 });
    const second = await resolveTtuCourseCatalog({ config: baseConfig, fetchImpl, now: 200 });

    expect(first.catalog).toEqual(catalog);
    expect(second.catalog).toEqual(catalog);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not call the catalog endpoint before it is configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(resolveTtuCourseCatalog({
      config: { ...baseConfig, courseCatalogPath: null },
      fetchImpl
    })).rejects.toMatchObject({ code: "CONFIG" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("TTU student schedule foundation", () => {
  it("strips unrelated student fields from the normalized response", () => {
    const normalized = normalizeTtuStudentSchedulePayload({
      data: {
        ...schedule,
        extraStudentName: "حقل إضافي",
        extraStudentNumber: "000000",
        extraBalance: 123
      }
    });

    expect(normalized).toEqual(schedule);
    expect(normalized).not.toHaveProperty("extraStudentName");
    expect(normalized).not.toHaveProperty("extraStudentNumber");
    expect(normalized).not.toHaveProperty("extraBalance");
  });

  it("uses the delegated bearer value for the student schedule request", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer delegated-test-value");
      expect(headers.get("Authorization")).not.toContain("service-test-value");

      return new Response(JSON.stringify({ schedule }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as unknown as typeof fetch;

    const result = await resolveTtuStudentSchedule("delegated-test-value", {
      config: baseConfig,
      fetchImpl
    });

    expect(result.schedule).toEqual(schedule);
    expect(result.meta.authMode).toBe("delegated-bearer");
  });

  it("does not call student schedule until delegated auth is explicitly enabled", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(resolveTtuStudentSchedule("delegated-test-value", {
      config: { ...baseConfig, studentAuthMode: "disabled" },
      fetchImpl
    })).rejects.toMatchObject({ code: "CONFIG" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("converts the official schedule into the current review-before-save contract", () => {
    const result = ttuStudentScheduleToExtractionResult(schedule);

    expect(result.draft.issues).toEqual([]);
    expect(result.draft.courses).toHaveLength(1);
    expect(result.draft.courses[0].name).toBe("هياكل البيانات");
    expect(result.draft.courses[0].sessions[0]).toMatchObject({
      day: "ح",
      startsAt: "09:00",
      endsAt: "10:00",
      roomRaw: "207 م",
      roomExpanded: "مجمع القاعات – قاعة 207",
      kind: "lecture"
    });
    expect(result.draft.courses[0].sessions[1].roomExpanded).toBe("مختبر الحاسوب ICT - 4");
  });

  it("converts a catalog section into the same review contract", () => {
    const result = ttuCatalogSectionToExtractionResult({
      courseName: catalog.courses[0].name,
      section: catalog.courses[0].sections[0]
    });

    expect(result.draft.courses).toHaveLength(1);
    expect(result.draft.courses[0].name).toBe("هياكل البيانات");
    expect(result.draft.courses[0].sessions[0].day).toBe("ح");
  });
});
