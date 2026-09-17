import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST, setTestScheduleExtractor } from "@/app/api/schedule/extract/route";
import type { ScheduleExtractionResult, ScheduleExtractor } from "@/domain/models";

describe("API Route Handler: POST /api/schedule/extract", () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    setTestScheduleExtractor(null);
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.GEMINI_API_KEY = originalKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
    setTestScheduleExtractor(null);
  });

  it("returns 400 when explicit consent is not provided", async () => {
    const formData = new FormData();
    const fakeFile = new Blob(["fake image data"], { type: "image/png" });
    formData.append("file", fakeFile, "test.png");
    // consent is omitted

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("الموافقة الصريحة");
  });

  it("returns 400 when file is missing", async () => {
    const formData = new FormData();
    formData.append("consent", "true");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("يرجى اختيار ملف صالح");
  });

  it("returns 400 when file type is unsupported", async () => {
    const formData = new FormData();
    formData.append("consent", "true");
    const textFile = new Blob(["some plain text"], { type: "text/plain" });
    formData.append("file", textFile, "notes.txt");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("نوع الملف غير مدعوم");
  });

  it("returns 503 when GEMINI_API_KEY is not configured", async () => {
    const formData = new FormData();
    formData.append("consent", "true");
    const validFile = new Blob(["image data"], { type: "image/jpeg" });
    formData.append("file", validFile, "schedule.jpg");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("ميزة التحليل الذكي غير مهيأة في بيئة التشغيل الحالية");
  });

  it("returns 200 with extraction result when valid file and test extractor double are used", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        const result: ScheduleExtractionResult = {
          draft: {
            courses: [
              {
                name: "برمجة مرئية",
                sessions: [
                  {
                    id: crypto.randomUUID(),
                    courseId: crypto.randomUUID(),
                    day: "ح",
                    startsAt: "10:00",
                    endsAt: "11:00",
                    roomRaw: "مختبر 1",
                    roomExpanded: "مختبر 1",
                    kind: "lab"
                  }
                ]
              }
            ],
            issues: []
          },
          confidence: { course_test_name: 0.96 }
        };
        return result;
      }
    };

    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    const validFile = new Blob(["valid image data"], { type: "image/png" });
    formData.append("file", validFile, "my-schedule.png");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.result.draft.courses).toHaveLength(1);
    expect(body.result.draft.courses[0].name).toBe("برمجة مرئية");
  });

  it("returns 503 with friendly Arabic message when model is unavailable or 404", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        throw new Error("GEMINI_MODEL_UNAVAILABLE");
      }
    };

    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    const validFile = new Blob(["valid image data"], { type: "image/png" });
    formData.append("file", validFile, "my-schedule.png");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("نموذج التحليل غير متاح حاليًا. يرجى تحديث إعدادات مزود الذكاء الاصطناعي أو المحاولة لاحقًا.");
  });

  it("returns 503 (not 500) with helpful Arabic message when service is overloaded (503 / GEMINI_SERVICE_UNAVAILABLE)", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        throw new Error("GEMINI_SERVICE_UNAVAILABLE");
      }
    };

    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    const validFile = new Blob(["valid image data"], { type: "image/png" });
    formData.append("file", validFile, "my-schedule.png");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("خدمة التحليل الذكي مشغولة حاليًا بسبب ضغط مرتفع. يرجى المحاولة مرة أخرى بعد قليل.");
  });

  it("returns 429 with specific Arabic quota message when rate limited (429 / GEMINI_RATE_LIMITED)", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        throw new Error("GEMINI_RATE_LIMITED");
      }
    };

    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    const validFile = new Blob(["valid image data"], { type: "image/png" });
    formData.append("file", validFile, "my-schedule.png");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(429);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("تم الوصول إلى حد الاستخدام المؤقت لخدمة التحليل. يرجى المحاولة لاحقًا.");
  });
});

