import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isSupportedMimeType,
  RawExtractionResponseSchema,
  validateUploadFile
} from "@/domain/ai/extraction-schema";
import {
  categorizeConfidence,
  normalizeDayCodes,
  normalizeExtractionResult,
  normalizeTime
} from "@/domain/ai/normalizer";
import { DEFAULT_GEMINI_MODEL, GeminiScheduleExtractor } from "@/domain/ai/gemini-extractor";
import { LocalScheduleRepository } from "@/storage/local-repository";
import { POST, setTestScheduleExtractor } from "@/app/api/schedule/extract/route";
import type { Course, ClassSession, ScheduleExtractor } from "@/domain/models";

describe("Smart Schedule Import - File & Schema Validation", () => {
  it("validates supported MIME types correctly", () => {
    expect(isSupportedMimeType("image/jpeg")).toBe(true);
    expect(isSupportedMimeType("image/png")).toBe(true);
    expect(isSupportedMimeType("image/webp")).toBe(true);
    expect(isSupportedMimeType("application/pdf")).toBe(true);

    expect(isSupportedMimeType("image/gif")).toBe(false);
    expect(isSupportedMimeType("application/zip")).toBe(false);
    expect(isSupportedMimeType("text/plain")).toBe(false);
  });

  it("validates file size limits (max 10MB)", () => {
    const validImage = { size: 5 * 1024 * 1024, type: "image/png" };
    expect(validateUploadFile(validImage).valid).toBe(true);

    const oversizedFile = { size: 10 * 1024 * 1024 + 1, type: "image/png" };
    const resultOver = validateUploadFile(oversizedFile);
    expect(resultOver.valid).toBe(false);
    expect(resultOver.error).toContain("10 ميجابايت");

    const unsupportedType = { size: 1024, type: "video/mp4" };
    const resultType = validateUploadFile(unsupportedType);
    expect(resultType.valid).toBe(false);
    expect(resultType.error).toContain("نوع الملف غير مدعوم");
  });

  it("parses valid raw AI extraction response via Zod", () => {
    const sampleRaw = {
      courses: [
        {
          courseName: "تفاضل وتكامل 1",
          nameConfidence: 0.98,
          sessions: [
            {
              day: "ح ث خ",
              startsAt: "08:30",
              endsAt: "09:30",
              room: "207 م",
              kind: "lecture",
              confidence: { day: 0.95, time: 0.95, room: 0.9 }
            }
          ]
        }
      ],
      issues: []
    };

    const parsed = RawExtractionResponseSchema.parse(sampleRaw);
    expect(parsed.courses).toHaveLength(1);
    expect(parsed.courses[0].courseName).toBe("تفاضل وتكامل 1");
  });
});

describe("Smart Schedule Import - Real Arabic Day Normalization", () => {
  it("normalizes every individual Arabic day name to its exact DayCode", () => {
    expect(normalizeDayCodes("السبت")).toEqual(["س"]);
    expect(normalizeDayCodes("سبت")).toEqual(["س"]);
    expect(normalizeDayCodes("س")).toEqual(["س"]);

    expect(normalizeDayCodes("الأحد")).toEqual(["ح"]);
    expect(normalizeDayCodes("الاحد")).toEqual(["ح"]);
    expect(normalizeDayCodes("أحد")).toEqual(["ح"]);
    expect(normalizeDayCodes("ح")).toEqual(["ح"]);

    expect(normalizeDayCodes("الاثنين")).toEqual(["ن"]);
    expect(normalizeDayCodes("الإثنين")).toEqual(["ن"]);
    expect(normalizeDayCodes("اثنين")).toEqual(["ن"]);
    expect(normalizeDayCodes("ن")).toEqual(["ن"]);

    expect(normalizeDayCodes("الثلاثاء")).toEqual(["ث"]);
    expect(normalizeDayCodes("ثلاثاء")).toEqual(["ث"]);
    expect(normalizeDayCodes("ث")).toEqual(["ث"]);

    expect(normalizeDayCodes("الأربعاء")).toEqual(["ر"]);
    expect(normalizeDayCodes("الاربعاء")).toEqual(["ر"]);
    expect(normalizeDayCodes("أربعاء")).toEqual(["ر"]);
    expect(normalizeDayCodes("ر")).toEqual(["ر"]);

    expect(normalizeDayCodes("الخميس")).toEqual(["خ"]);
    expect(normalizeDayCodes("خميس")).toEqual(["خ"]);
    expect(normalizeDayCodes("خ")).toEqual(["خ"]);
  });

  it("normalizes combined Arabic day strings correctly", () => {
    expect(normalizeDayCodes("الأحد والثلاثاء والخميس")).toEqual(["ح", "ث", "خ"]);
    expect(normalizeDayCodes("الاثنين والاربعاء")).toEqual(["ن", "ر"]);
    expect(normalizeDayCodes("ح ث خ")).toEqual(["ح", "ث", "خ"]);
    expect(normalizeDayCodes("حثخ")).toEqual(["ح", "ث", "خ"]);
    expect(normalizeDayCodes("ن ر")).toEqual(["ن", "ر"]);
    expect(normalizeDayCodes("نر")).toEqual(["ن", "ر"]);
    expect(normalizeDayCodes("ح، ث، خ")).toEqual(["ح", "ث", "خ"]);
    expect(normalizeDayCodes("ن / ر")).toEqual(["ن", "ر"]);
    expect(normalizeDayCodes("")).toEqual([]);
    expect(normalizeDayCodes("غير معروف")).toEqual([]);
  });

  it("ensures missing day does NOT default to Sunday", () => {
    const rawNoDay = {
      courses: [
        {
          courseName: "خوارزميات",
          nameConfidence: 0.95,
          sessions: [
            {
              day: "",
              startsAt: "10:00",
              endsAt: "11:00",
              room: "207 م",
              kind: "lecture" as const,
              confidence: { day: 0, time: 0.9, room: 0.9 }
            }
          ]
        }
      ],
      issues: []
    };

    const result = normalizeExtractionResult(rawNoDay);
    expect(result.draft.courses).toHaveLength(1);
    const session = result.draft.courses[0].sessions[0];
    expect(session.day).toBeNull();
    expect(session.day).not.toBe("ح");
    expect(result.draft.issues.some((i) => i.message.includes("تحديد يوم المحاضرة"))).toBe(true);
  });
});

describe("Smart Schedule Import - Time Normalization Without Guessing", () => {
  it("normalizes explicit 24-hour and AM/PM times", () => {
    expect(normalizeTime("08:00")).toBe("08:00");
    expect(normalizeTime("08:30")).toBe("08:30");
    expect(normalizeTime("14:00")).toBe("14:00");
    expect(normalizeTime("11:30")).toBe("11:30");

    expect(normalizeTime("8:00 AM")).toBe("08:00");
    expect(normalizeTime("8:00 ص")).toBe("08:00");
    expect(normalizeTime("01:30 PM")).toBe("13:30");
    expect(normalizeTime("1:30 م")).toBe("13:30");
    expect(normalizeTime("2:00 PM")).toBe("14:00");
    expect(normalizeTime("2:00 م")).toBe("14:00");
  });

  it("does NOT silently convert ambiguous 1-6 hours without AM/PM marker", () => {
    expect(normalizeTime("2:00")).toBeNull();
    expect(normalizeTime("02:00")).toBeNull();
    expect(normalizeTime("1:30")).toBeNull();
    expect(normalizeTime("3:00")).toBeNull();
    expect(normalizeTime("4:15")).toBeNull();
    expect(normalizeTime("5:00")).toBeNull();
    expect(normalizeTime("6:00")).toBeNull();
  });

  it("ensures missing start time does NOT default to 08:30", () => {
    const rawNoStart = {
      courses: [
        {
          courseName: "خوارزميات",
          nameConfidence: 0.95,
          sessions: [
            {
              day: "ح",
              startsAt: "",
              endsAt: "11:00",
              room: "207 م",
              kind: "lecture" as const,
              confidence: { day: 0.9, time: 0, room: 0.9 }
            }
          ]
        }
      ],
      issues: []
    };

    const result = normalizeExtractionResult(rawNoStart);
    const session = result.draft.courses[0].sessions[0];
    expect(session.startsAt).toBeNull();
    expect(session.startsAt).not.toBe("08:30");
    expect(result.draft.issues.some((i) => i.message.includes("وقت بدء المحاضرة"))).toBe(true);
  });

  it("ensures missing end time is NOT invented (no 60/90 minute guessing)", () => {
    const rawNoEnd = {
      courses: [
        {
          courseName: "خوارزميات",
          nameConfidence: 0.95,
          sessions: [
            {
              day: "ح",
              startsAt: "10:00",
              endsAt: "",
              room: "207 م",
              kind: "lecture" as const,
              confidence: { day: 0.9, time: 0, room: 0.9 }
            }
          ]
        }
      ],
      issues: []
    };

    const result = normalizeExtractionResult(rawNoEnd);
    const session = result.draft.courses[0].sessions[0];
    expect(session.endsAt).toBeNull();
    expect(result.draft.issues.some((i) => i.message.includes("وقت انتهاء المحاضرة"))).toBe(true);
  });
});

describe("Smart Schedule Import - TTU Verified Buildings vs Unverified Codes", () => {
  it("expands only verified Foundation buildings (م، هـ، ع) and leaves unknown codes raw", () => {
    const rawData = {
      courses: [
        {
          courseName: "فيزياء عامة 1",
          nameConfidence: 0.95,
          sessions: [
            {
              day: "ح",
              startsAt: "09:30",
              endsAt: "10:30",
              room: "205 هـ",
              kind: "lecture" as const,
              confidence: { day: 0.9, time: 0.9, room: 0.85 }
            },
            {
              day: "ث",
              startsAt: "09:30",
              endsAt: "10:30",
              room: "207 م",
              kind: "lecture" as const,
              confidence: { day: 0.9, time: 0.9, room: 0.85 }
            },
            {
              day: "خ",
              startsAt: "09:30",
              endsAt: "10:30",
              room: "302 ع",
              kind: "lecture" as const,
              confidence: { day: 0.9, time: 0.9, room: 0.85 }
            },
            {
              day: "ن",
              startsAt: "11:30",
              endsAt: "13:00",
              room: "204 ح", // Unverified building code in Foundation!
              kind: "lab" as const,
              confidence: { day: 0.9, time: 0.9, room: 0.85 }
            }
          ]
        }
      ],
      issues: []
    };

    const result = normalizeExtractionResult(rawData);
    const sessions = result.draft.courses[0].sessions;

    // Verified: هـ -> كلية الهندسة
    expect(sessions[0].roomRaw).toBe("205 هـ");
    expect(sessions[0].roomExpanded).toContain("كلية الهندسة");

    // Verified: م -> مجمع القاعات
    expect(sessions[1].roomRaw).toBe("207 م");
    expect(sessions[1].roomExpanded).toContain("مجمع القاعات");

    // Verified: ع -> كلية الأعمال
    expect(sessions[2].roomRaw).toBe("302 ع");
    expect(sessions[2].roomExpanded).toContain("كلية الأعمال");

    // UNVERIFIED: ح -> must remain raw without invented expansion!
    expect(sessions[3].roomRaw).toBe("204 ح");
    expect(sessions[3].roomExpanded).toBeUndefined();
  });
});

describe("Smart Schedule Import - Course Name Without Invention", () => {
  it("does not invent course names like 'مادة غير مسماة 1'", () => {
    const rawEmptyName = {
      courses: [
        {
          courseName: "  ",
          nameConfidence: 0.2,
          sessions: [
            {
              day: "ح",
              startsAt: "08:30",
              endsAt: "09:30",
              room: "207 م",
              kind: "lecture" as const,
              confidence: { day: 0.9, time: 0.9, room: 0.9 }
            }
          ]
        }
      ],
      issues: []
    };

    const result = normalizeExtractionResult(rawEmptyName);
    expect(result.draft.courses[0].name).toBe("");
    expect(result.draft.courses[0].name).not.toContain("مادة غير مسماة");
    expect(result.draft.issues.some((i) => i.message.includes("غير مقروء أو مفقود"))).toBe(true);
  });
});

describe("Smart Schedule Import - Atomic Batch Save in Repository", () => {
  it("saves multiple imported courses and sessions atomically via saveCourses", async () => {
    const repo = new LocalScheduleRepository();
    const courseId1 = crypto.randomUUID();
    const courseId2 = crypto.randomUUID();

    const batch = [
      {
        course: {
          id: courseId1,
          termId: crypto.randomUUID(),
          name: "مادة تجريبية 1",
          reminder: { enabled: true, minutesBefore: 15 },
          createdAt: new Date().toISOString()
        } as Course,
        sessions: [
          {
            id: crypto.randomUUID(),
            courseId: courseId1,
            day: "ح",
            startsAt: "08:30",
            endsAt: "09:30",
            room: { raw: "207 م", label: "مجمع القاعات – قاعة 207", isOnline: false },
            kind: "lecture"
          } as ClassSession
        ]
      },
      {
        course: {
          id: courseId2,
          termId: crypto.randomUUID(),
          name: "مادة تجريبية 2",
          reminder: { enabled: false, minutesBefore: 0 },
          createdAt: new Date().toISOString()
        } as Course,
        sessions: [
          {
            id: crypto.randomUUID(),
            courseId: courseId2,
            day: "ن",
            startsAt: "10:00",
            endsAt: "11:30",
            room: { raw: "online", label: "عبر الإنترنت", isOnline: true },
            kind: "lecture"
          } as ClassSession
        ]
      }
    ];

    await repo.saveCourses(batch);
    const snapshot = await repo.snapshot();

    expect(snapshot.courses.some((c) => c.id === courseId1)).toBe(true);
    expect(snapshot.courses.some((c) => c.id === courseId2)).toBe(true);
    expect(snapshot.sessions.some((s) => s.courseId === courseId1)).toBe(true);
    expect(snapshot.sessions.some((s) => s.courseId === courseId2)).toBe(true);
  });
});

describe("Smart Schedule Import - Gemini Model Configuration & 404 Handling", () => {
  it("defaults to gemini-3.6-flash as the centralized model", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.6-flash");
    const extractor = new GeminiScheduleExtractor({ apiKey: "fake-key" });
    expect(extractor.model).toBe("gemini-3.6-flash");
  });

  it("allows overriding model via options or environment variable", () => {
    const customExtractor = new GeminiScheduleExtractor({
      apiKey: "fake-key",
      model: "custom-model"
    });
    expect(customExtractor.model).toBe("custom-model");
  });

  it("targets the exact gemini-3.6-flash generateContent endpoint", async () => {
    let capturedUrl = "";
    const mockFetch = (async (url: string | URL | Request) => {
      capturedUrl = url.toString();
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ courses: [], issues: [] }) }]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-api-key",
      fetchFn: mockFetch
    });

    await extractor.extract({
      fileName: "schedule.png",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png"
    });

    expect(capturedUrl).toContain("models/gemini-3.6-flash:generateContent");
    expect(capturedUrl).toContain("key=test-api-key");
  });

  it("throws GEMINI_MODEL_UNAVAILABLE when API responds with 404", async () => {
    const mockFetch404 = (async () => {
      return new Response("Model not found or unavailable", {
        status: 404,
        headers: { "Content-Type": "text/plain" }
      });
    }) as typeof fetch;

    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch404
    });

    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toThrow("GEMINI_MODEL_UNAVAILABLE");
  });

  it("retries transient 503 error up to 3 bounded attempts and throws GEMINI_SERVICE_UNAVAILABLE", async () => {
    let callCount = 0;
    const mockFetch503 = (async () => {
      callCount++;
      return new Response("High demand", { status: 503, headers: { "Content-Type": "text/plain" } });
    }) as typeof fetch;

    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch503,
      retryDelaysMs: [1, 1]
    });

    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toThrow("GEMINI_SERVICE_UNAVAILABLE");

    expect(callCount).toBe(3);
  });

  it("retries 429 rate limit error up to 3 bounded attempts and throws GEMINI_RATE_LIMITED", async () => {
    let callCount = 0;
    const mockFetch429 = (async () => {
      callCount++;
      return new Response("Rate limit exceeded", { status: 429, headers: { "Content-Type": "text/plain" } });
    }) as typeof fetch;

    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch429,
      retryDelaysMs: [1, 1]
    });

    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toThrow("GEMINI_RATE_LIMITED");

    expect(callCount).toBe(3);
  });

  it("does NOT retry 400, 401, 403, or 404 errors (fails immediately after 1 attempt)", async () => {
    for (const status of [400, 401, 403, 404]) {
      let callCount = 0;
      const mockFetch = (async () => {
        callCount++;
        return new Response("Client error", { status, headers: { "Content-Type": "text/plain" } });
      }) as typeof fetch;

      const extractor = new GeminiScheduleExtractor({
        apiKey: "test-key",
        fetchFn: mockFetch,
        retryDelaysMs: [1, 1]
      });

      await expect(
        extractor.extract({
          fileName: "schedule.png",
          bytes: new Uint8Array([1, 2, 3])
        })
      ).rejects.toThrow();

      expect(callCount).toBe(1);
    }
  });

  it("succeeds on second attempt if first transient failure recovers", async () => {
    let callCount = 0;
    const mockFetchRecover = (async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Temporary blip", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ courses: [], issues: [] }) }]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetchRecover,
      retryDelaysMs: [1, 1]
    });

    const result = await extractor.extract({
      fileName: "schedule.png",
      bytes: new Uint8Array([1, 2, 3])
    });

    expect(callCount).toBe(2);
    expect(result.draft.courses).toEqual([]);
  });

  it("aborts and halts further retries when signal is aborted or timed out", async () => {
    let callCount = 0;
    const mockFetchSlow = (async () => {
      callCount++;
      return new Response("Unavailable", { status: 503 });
    }) as typeof fetch;

    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetchSlow,
      timeoutMs: 20,
      retryDelaysMs: [500, 500]
    });

    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toThrow("AI_PROVIDER_TIMEOUT");

    expect(callCount).toBeLessThan(3);
  });
});

describe("Smart Schedule Import - Timeout Budget (3-attempt policy must actually run)", () => {
  const originalEnv = process.env.AI_PROVIDER_TIMEOUT_MS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AI_PROVIDER_TIMEOUT_MS;
    } else {
      process.env.AI_PROVIDER_TIMEOUT_MS = originalEnv;
    }
  });

  it("three consecutive 503 responses are classified as GEMINI_SERVICE_UNAVAILABLE, not AI_PROVIDER_TIMEOUT", async () => {
    let callCount = 0;
    const mockFetch503 = (async () => {
      callCount++;
      return new Response("High demand", { status: 503, headers: { "Content-Type": "text/plain" } });
    }) as typeof fetch;

    // Use a generous budget so all 3 attempts can run. This mirrors the
    // production default (60_000 ms) and proves the budget is no longer
    // cutting off attempt 3.
    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch503,
      retryDelaysMs: [1, 1],
      timeoutMs: 60_000
    });

    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toThrow("GEMINI_SERVICE_UNAVAILABLE");

    // Crucially, all 3 attempts must have been allowed to run.
    expect(callCount).toBe(3);
  });

  it("a truly hanging provider (fetch never resolves) is classified as AI_PROVIDER_TIMEOUT", async () => {
    // fetch that never resolves until the test ends — we abort it via the
    // extractor-internal budget.
    const mockFetchHang = (async (_url: string | URL | Request, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (!signal) return;
        signal.addEventListener("abort", () => {
          const err: any = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;

    // Tiny budget: 30 ms total. This is the "real timeout" path.
    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetchHang,
      retryDelaysMs: [1, 1],
      timeoutMs: 30
    });

    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toThrow("AI_PROVIDER_TIMEOUT");
  });

  it("internal timeout firing during inter-attempt backoff aborts retries and surfaces as AI_PROVIDER_TIMEOUT", async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      return new Response("Busy", { status: 503 });
    }) as typeof fetch;

    // Tiny overall budget: the first attempt fires, then the timer
    // should fire DURING the second-attempt backoff sleep, aborting the
    // loop before a 3rd fetch can occur.
    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch,
      retryDelaysMs: [200, 200],
      timeoutMs: 30
    });

    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3])
      })
    ).rejects.toThrow("AI_PROVIDER_TIMEOUT");

    // The loop must not have run all 3 attempts — the budget fired.
    expect(callCount).toBeLessThan(3);
  });

  it("resolveProviderTimeoutMs honors AI_PROVIDER_TIMEOUT_MS env var", async () => {
    process.env.AI_PROVIDER_TIMEOUT_MS = "12345";
    const { resolveProviderTimeoutMs } = await import("@/domain/ai/gemini-extractor");
    expect(resolveProviderTimeoutMs()).toBe(12345);
  });

  it("resolveProviderTimeoutMs defaults to 60_000 when env is unset and no option is given", async () => {
    delete process.env.AI_PROVIDER_TIMEOUT_MS;
    const { resolveProviderTimeoutMs, DEFAULT_AI_PROVIDER_TIMEOUT_MS } = await import("@/domain/ai/gemini-extractor");
    expect(resolveProviderTimeoutMs()).toBe(DEFAULT_AI_PROVIDER_TIMEOUT_MS);
    expect(DEFAULT_AI_PROVIDER_TIMEOUT_MS).toBe(60_000);
  });

  it("explicit timeoutMs option wins over env var", async () => {
    process.env.AI_PROVIDER_TIMEOUT_MS = "5000";
    const { resolveProviderTimeoutMs } = await import("@/domain/ai/gemini-extractor");
    expect(resolveProviderTimeoutMs(42_000)).toBe(42_000);
  });
});

describe("Smart Schedule Import - Route classification of repeated 503 vs real timeout", () => {
  const originalEnv = process.env.AI_PROVIDER_TIMEOUT_MS;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    setTestScheduleExtractor(null);
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AI_PROVIDER_TIMEOUT_MS;
    } else {
      process.env.AI_PROVIDER_TIMEOUT_MS = originalEnv;
    }
    setTestScheduleExtractor(null);
  });

  it("repeated 503 from extractor surfaces as HTTP 503 (GEMINI_SERVICE_UNAVAILABLE), not 504", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        throw new Error("GEMINI_SERVICE_UNAVAILABLE");
      }
    };
    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    formData.append("file", new Blob(["x"], { type: "image/png" }), "s.png");

    const request = new Request("http://localhost:3002/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("مشغولة");
  });

  it("a true extractor timeout surfaces as HTTP 504 (AI_PROVIDER_TIMEOUT)", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        throw new Error("AI_PROVIDER_TIMEOUT");
      }
    };
    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    formData.append("file", new Blob(["x"], { type: "image/png" }), "s.png");

    const request = new Request("http://localhost:3002/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(504);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("وقتاً طويلاً");
  });
});

describe("Smart Schedule Import - Real Case: Multi-Session Course Isolation (Lecture 207 م + Lab ICT-4)", () => {
  it("isolates lecture sessions (207 م) and lab session (ICT - 4) with independent rooms, kinds, and days", async () => {
    const realCourseRaw = {
      courses: [
        {
          courseName: "تصميم البيانات",
          nameConfidence: 0.96,
          sessions: [
            {
              day: "ح ث خ",
              startsAt: "10:00",
              endsAt: "11:00",
              room: "207 م",
              kind: "lecture" as const,
              confidence: { day: 0.95, time: 0.95, room: 0.92 }
            },
            {
              day: "ن",
              startsAt: "08:30",
              endsAt: "10:30",
              room: "ICT - 4",
              kind: "lab" as const,
              confidence: { day: 0.95, time: 0.95, room: 0.90 }
            }
          ]
        }
      ],
      issues: []
    };

    const normalized = normalizeExtractionResult(realCourseRaw);
    expect(normalized.draft.courses).toHaveLength(1);

    const course = normalized.draft.courses[0];
    expect(course.name).toBe("تصميم البيانات");
    expect(course.sessions).toHaveLength(4);

    // Verify all 4 session objects are strictly unique references
    const uniqueSessionObjects = new Set(course.sessions);
    expect(uniqueSessionObjects.size).toBe(4);

    // 3 lecture sessions (Sun, Tue, Thu)
    const lectureSessions = course.sessions.filter((s) => s.kind === "lecture");
    expect(lectureSessions).toHaveLength(3);

    const lectureDays = lectureSessions.map((s) => s.day).sort();
    expect(lectureDays).toEqual(["ث", "ح", "خ"]);

    for (const s of lectureSessions) {
      expect(s.startsAt).toBe("10:00");
      expect(s.endsAt).toBe("11:00");
      expect(s.roomRaw).toBe("207 م");
      expect(s.roomExpanded).toContain("مجمع القاعات");
      expect(s.roomExpanded).toContain("207");
      expect(s.kind).toBe("lecture");

      // Verify strict isolation: ICT - 4 must NEVER appear in lecture sessions
      expect(s.roomRaw).not.toContain("ICT");
      expect(s.roomRaw).not.toContain("4");
      if (s.roomExpanded) {
        expect(s.roomExpanded).not.toContain("ICT");
      }
    }

    // 1 lab session (Mon)
    const labSessions = course.sessions.filter((s) => s.kind === "lab");
    expect(labSessions).toHaveLength(1);

    const labSession = labSessions[0];
    expect(labSession.day).toBe("ن");
    expect(labSession.startsAt).toBe("08:30");
    expect(labSession.endsAt).toBe("10:30");
    expect(labSession.roomRaw).toBe("ICT - 4");
    expect(labSession.roomExpanded).toBe("مختبر الحاسوب ICT - 4");
    expect(labSession.kind).toBe("lab");

    // Verify strict isolation: 207 م must NEVER appear in lab session
    expect(labSession.roomRaw).not.toContain("207");
    expect(labSession.roomRaw).not.toContain("م");
    if (labSession.roomExpanded) {
      expect(labSession.roomExpanded).not.toContain("207");
      expect(labSession.roomExpanded).not.toContain("مجمع");
    }

    // Now verify save flow with repository
    const repo = new LocalScheduleRepository();
    const courseId = crypto.randomUUID();
    const savedCourse: Course = {
      id: courseId,
      termId: crypto.randomUUID(),
      name: course.name,
      reminder: { enabled: true, minutesBefore: 15 },
      createdAt: new Date().toISOString()
    };

    const savedSessions: ClassSession[] = course.sessions.map((s) => ({
      id: crypto.randomUUID(),
      courseId,
      day: s.day!,
      startsAt: s.startsAt!,
      endsAt: s.endsAt!,
      room: {
        raw: s.roomRaw,
        label: s.roomExpanded || s.roomRaw,
        isOnline: false
      },
      kind: s.kind as "lecture" | "lab"
    }));

    await repo.saveCourses([{ course: savedCourse, sessions: savedSessions }]);

    const snapshot = await repo.snapshot();
    const storedSessions = snapshot.sessions.filter((s) => s.courseId === courseId);
    expect(storedSessions).toHaveLength(4);

    const storedLectures = storedSessions.filter((s) => s.kind === "lecture");
    expect(storedLectures).toHaveLength(3);
    for (const ls of storedLectures) {
      expect(ls.room.raw).toBe("207 م");
      expect(ls.room.label).toContain("مجمع القاعات");
      expect(ls.room.label).not.toContain("ICT");
    }

    const storedLab = storedSessions.find((s) => s.kind === "lab");
    expect(storedLab).toBeDefined();
    expect(storedLab?.day).toBe("ن");
    expect(storedLab?.room.raw).toBe("ICT - 4");
    expect(storedLab?.room.label).toBe("مختبر الحاسوب ICT - 4");
    expect(storedLab?.room.label).not.toContain("207");
  });
});
