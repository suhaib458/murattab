import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST, setTestScheduleExtractor } from "@/app/api/schedule/extract/route";
import type { ScheduleExtractionResult, ScheduleExtractor } from "@/domain/models";

describe("API Route Handler: POST /api/schedule/extract", () => {
  const originalKey = process.env.XKIRO_API_KEY;

  beforeEach(() => {
    delete process.env.XKIRO_API_KEY;
    delete process.env.GEMINI_API_KEY;
    setTestScheduleExtractor(null);
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.XKIRO_API_KEY = originalKey;
    } else {
      delete process.env.XKIRO_API_KEY;
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

  it("returns 400 when file size exceeds 4MB and rejects before extractor invocation", async () => {
    let extractorCalled = false;
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        extractorCalled = true;
        throw new Error("Should not be called");
      }
    };
    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    const oversizedBlob = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "image/png" });
    formData.append("file", oversizedBlob, "huge.png");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("4 ميجابايت");
    expect(extractorCalled).toBe(false);
  });

  it("returns 400 when AI_INVALID_INPUT_PAYLOAD_TOO_LARGE is thrown", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        throw new Error("AI_INVALID_INPUT_PAYLOAD_TOO_LARGE");
      }
    };
    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    const validFile = new Blob(["image data"], { type: "image/png" });
    formData.append("file", validFile, "schedule.png");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("الحد الداخلي الآمن للإرسال");
  });

  it("returns 503 when XKIRO_API_KEY is not configured", async () => {
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
    for (const errCode of ["AI_MODEL_UNAVAILABLE", "GEMINI_MODEL_UNAVAILABLE"]) {
      const mockExtractor: ScheduleExtractor = {
        extract: async () => {
          throw new Error(errCode);
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
      expect(body.error).toBe(
        "نموذج التحليل غير متاح حاليًا. يرجى تحديث إعدادات مزود الذكاء الاصطناعي أو المحاولة لاحقًا."
      );
    }
  });

  it("returns 503 with helpful Arabic message when service is overloaded (AI_SERVICE_UNAVAILABLE)", async () => {
    for (const errCode of ["AI_SERVICE_UNAVAILABLE", "GEMINI_SERVICE_UNAVAILABLE"]) {
      const mockExtractor: ScheduleExtractor = {
        extract: async () => {
          throw new Error(errCode);
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
      expect(body.error).toBe(
        "خدمة التحليل الذكي مشغولة حاليًا بسبب ضغط مرتفع. يرجى المحاولة مرة أخرى بعد قليل."
      );
    }
  });

  it("returns 429 with specific Arabic quota message when rate limited (AI_RATE_LIMITED)", async () => {
    for (const errCode of ["AI_RATE_LIMITED", "GEMINI_RATE_LIMITED"]) {
      const mockExtractor: ScheduleExtractor = {
        extract: async () => {
          throw new Error(errCode);
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
      expect(body.error).toBe(
        "تم الوصول إلى حد الاستخدام المؤقت لخدمة التحليل. يرجى المحاولة لاحقًا."
      );
    }
  });

  it("returns 400 with specific Arabic message when PDF exceeds page limit", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        throw new Error("AI_INVALID_INPUT_PDF_PAGE_LIMIT");
      }
    };

    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    const validFile = new Blob(["%PDF-1.4..."], { type: "application/pdf" });
    formData.append("file", validFile, "schedule.pdf");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
      method: "POST",
      body: formData
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("الحد الأقصى للصفحات المدعومة للجدول الدراسي");
  });

  it("returns 504 with friendly timeout message when AI_PROVIDER_TIMEOUT occurs", async () => {
    const mockExtractor: ScheduleExtractor = {
      extract: async () => {
        throw new Error("AI_PROVIDER_TIMEOUT");
      }
    };

    setTestScheduleExtractor(mockExtractor);

    const formData = new FormData();
    formData.append("consent", "true");
    const validFile = new Blob(["image data"], { type: "image/png" });
    formData.append("file", validFile, "schedule.png");

    const request = new Request("http://localhost:3000/api/schedule/extract", {
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
