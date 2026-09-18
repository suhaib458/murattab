import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_XKIRO_MODEL,
  resolveProviderTimeoutMs,
  XKIRO_API_ENDPOINT,
  XKiroScheduleExtractor
} from "@/domain/ai/xkiro-extractor";
import type { RasterizedImage } from "@/domain/ai/pdf-rasterizer";

describe("XKiroScheduleExtractor", () => {
  const originalEnvKey = process.env.XKIRO_API_KEY;
  const originalEnvModel = process.env.XKIRO_MODEL;
  const originalEnvTimeout = process.env.AI_PROVIDER_TIMEOUT_MS;

  beforeEach(() => {
    delete process.env.XKIRO_API_KEY;
    delete process.env.XKIRO_MODEL;
    delete process.env.AI_PROVIDER_TIMEOUT_MS;
  });

  afterEach(() => {
    if (originalEnvKey !== undefined) process.env.XKIRO_API_KEY = originalEnvKey;
    else delete process.env.XKIRO_API_KEY;

    if (originalEnvModel !== undefined) process.env.XKIRO_MODEL = originalEnvModel;
    else delete process.env.XKIRO_MODEL;

    if (originalEnvTimeout !== undefined) process.env.AI_PROVIDER_TIMEOUT_MS = originalEnvTimeout;
    else delete process.env.AI_PROVIDER_TIMEOUT_MS;
  });

  it("throws AI_API_KEY_MISSING when no API key is provided", async () => {
    const extractor = new XKiroScheduleExtractor();
    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("AI_API_KEY_MISSING");
  });

  it("uses DEFAULT_XKIRO_MODEL by default", () => {
    const extractor = new XKiroScheduleExtractor({ apiKey: "test-key" });
    expect(extractor.model).toBe(DEFAULT_XKIRO_MODEL);
    expect(extractor.model).toBe("qwen/qwen3.8-omni-flash:free");
  });

  it("respects XKIRO_MODEL from environment or constructor options", () => {
    process.env.XKIRO_MODEL = "qwen/custom-model";
    const extractorEnv = new XKiroScheduleExtractor({ apiKey: "test-key" });
    expect(extractorEnv.model).toBe("qwen/custom-model");

    const extractorOpt = new XKiroScheduleExtractor({
      apiKey: "test-key",
      model: "qwen/override-model"
    });
    expect(extractorOpt.model).toBe("qwen/override-model");
  });

  it("sends correct OpenAI-compatible request format with headers, model, and image data URL", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      capturedUrl = url.toString();
      capturedHeaders = init?.headers as Record<string, string>;
      capturedBody = JSON.parse(init?.body as string);

      const fakeOutput = {
        choices: [
          {
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                courses: [
                  {
                    courseName: "فيزياء عامة 1",
                    nameConfidence: 0.95,
                    sessions: [
                      {
                        day: "ح ث خ",
                        startsAt: "08:30",
                        endsAt: "09:30",
                        room: "105 ع",
                        kind: "lecture",
                        confidence: { day: 0.95, time: 0.95, room: 0.9 }
                      }
                    ]
                  }
                ],
                issues: []
              })
            }
          }
        ]
      };

      return new Response(JSON.stringify(fakeOutput), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "secret-key-123",
      fetchFn: mockFetch
    });

    const testBytes = new Uint8Array([10, 20, 30, 40]);
    const result = await extractor.extract({
      fileName: "my-schedule.png",
      bytes: testBytes,
      mimeType: "image/png"
    });

    // Verify endpoint & headers
    expect(capturedUrl).toBe(XKIRO_API_ENDPOINT);
    expect(capturedHeaders["Authorization"]).toBe("Bearer secret-key-123");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");

    // Verify body structure
    expect(capturedBody.model).toBe("qwen/qwen3.8-omni-flash:free");
    expect(capturedBody.response_format).toEqual({ type: "json_object" });
    expect(capturedBody.temperature).toBe(0.1);
    expect(capturedBody.messages).toHaveLength(2);
    expect(capturedBody.messages[0].role).toBe("system");
    expect(capturedBody.messages[1].role).toBe("user");

    const userContent = capturedBody.messages[1].content;
    expect(userContent).toHaveLength(2);
    expect(userContent[0].type).toBe("text");
    expect(userContent[1].type).toBe("image_url");

    const expectedBase64 = Buffer.from(testBytes).toString("base64");
    expect(userContent[1].image_url.url).toBe(`data:image/png;base64,${expectedBase64}`);

    // Verify parsed result
    expect(result.draft.courses).toHaveLength(1);
    expect(result.draft.courses[0].name).toBe("فيزياء عامة 1");
  });

  it("supports image/jpeg and image/webp MIME types", async () => {
    for (const mimeType of ["image/jpeg", "image/webp"]) {
      let capturedBody: any = null;
      const mockFetch = (async (_url: any, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify({ courses: [], issues: [] }) }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as typeof fetch;

      const extractor = new XKiroScheduleExtractor({
        apiKey: "test-key",
        fetchFn: mockFetch
      });

      await extractor.extract({
        fileName: "file",
        bytes: new Uint8Array([1, 2]),
        mimeType
      });

      const userContent = capturedBody.messages[1].content;
      expect(userContent[1].image_url.url).toContain(`data:${mimeType};base64,`);
    }
  });

  it("rejects unsupported MIME types with AI_INVALID_INPUT", async () => {
    const extractor = new XKiroScheduleExtractor({ apiKey: "test-key" });
    await expect(
      extractor.extract({
        fileName: "file.gif",
        bytes: new Uint8Array([1, 2]),
        mimeType: "image/gif"
      })
    ).rejects.toThrow("AI_INVALID_INPUT");
  });

  it("handles markdown code fences (```json ... ```) in model output", async () => {
    const mockFetch = (async () => {
      const payload = "```json\n" + JSON.stringify({ courses: [], issues: [] }) + "\n```";
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: payload } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch
    });

    const result = await extractor.extract({
      fileName: "test.png",
      bytes: new Uint8Array([1, 2]),
      mimeType: "image/png"
    });

    expect(result.draft.courses).toEqual([]);
  });

  it("handles schema-invalid output gracefully with fallback normalization", async () => {
    const mockFetch = (async () => {
      // Model returned object with unparseable session shapes
      const payload = JSON.stringify({
        courses: [{ courseName: "برمجة", sessions: [{ day: "invalid-day", startsAt: "foo" }] }],
        issues: []
      });
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: payload } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch
    });

    const result = await extractor.extract({
      fileName: "test.png",
      bytes: new Uint8Array([1, 2]),
      mimeType: "image/png"
    });

    expect(result.draft.courses).toHaveLength(1);
    expect(result.draft.courses[0].name).toBe("برمجة");
  });

  it("throws EMPTY_AI_RESPONSE when choices array is empty or content is blank", async () => {
    const mockFetchEmpty = (async () => {
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetchEmpty
    });

    await expect(
      extractor.extract({
        fileName: "test.png",
        bytes: new Uint8Array([1]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("EMPTY_AI_RESPONSE");
  });

  it("throws AI_INVALID_RESPONSE when finish_reason is length (truncated output)", async () => {
    const mockFetchTruncated = (async () => {
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "length",
              message: { content: '{"courses": [{"name": "incomplete' }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetchTruncated
    });

    await expect(
      extractor.extract({
        fileName: "test.png",
        bytes: new Uint8Array([1]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("AI_INVALID_RESPONSE");
  });

  it("throws INVALID_JSON_FROM_AI when content is not valid JSON", async () => {
    const mockFetchInvalid = (async () => {
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: "Here is your schedule: sorry!" } }]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetchInvalid
    });

    await expect(
      extractor.extract({
        fileName: "test.png",
        bytes: new Uint8Array([1]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("INVALID_JSON_FROM_AI");
  });

  it("maps 401 and 403 HTTP errors to AI_INVALID_KEY immediately (no retries)", async () => {
    for (const status of [401, 403]) {
      let callCount = 0;
      const mockFetch = (async () => {
        callCount++;
        return new Response("Unauthorized", { status });
      }) as typeof fetch;

      const extractor = new XKiroScheduleExtractor({
        apiKey: "bad-key",
        fetchFn: mockFetch,
        retryDelaysMs: [1, 1]
      });

      await expect(
        extractor.extract({
          fileName: "test.png",
          bytes: new Uint8Array([1]),
          mimeType: "image/png"
        })
      ).rejects.toThrow("AI_INVALID_KEY");

      expect(callCount).toBe(1);
    }
  });

  it("maps 404 HTTP error to AI_MODEL_UNAVAILABLE immediately", async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount++;
      return new Response("Model not found", { status: 404 });
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch,
      retryDelaysMs: [1, 1]
    });

    await expect(
      extractor.extract({
        fileName: "test.png",
        bytes: new Uint8Array([1]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("AI_MODEL_UNAVAILABLE");

    expect(callCount).toBe(1);
  });

  it("retries transient 503 errors up to 3 bounded attempts and throws AI_SERVICE_UNAVAILABLE", async () => {
    let callCount = 0;
    const mockFetch503 = (async () => {
      callCount++;
      return new Response("Busy", { status: 503 });
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch503,
      retryDelaysMs: [1, 1],
      timeoutMs: 50_000
    });

    await expect(
      extractor.extract({
        fileName: "test.png",
        bytes: new Uint8Array([1]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("AI_SERVICE_UNAVAILABLE");

    expect(callCount).toBe(3);
  });

  it("retries 429 rate limit errors up to 3 bounded attempts and throws AI_RATE_LIMITED", async () => {
    let callCount = 0;
    const mockFetch429 = (async () => {
      callCount++;
      return new Response("Rate limit", { status: 429 });
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch429,
      retryDelaysMs: [1, 1],
      timeoutMs: 50_000
    });

    await expect(
      extractor.extract({
        fileName: "test.png",
        bytes: new Uint8Array([1]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("AI_RATE_LIMITED");

    expect(callCount).toBe(3);
  });

  it("halts retries and throws AI_PROVIDER_TIMEOUT when total deadline budget expires", async () => {
    let callCount = 0;
    const mockFetchSlow = (async () => {
      callCount++;
      return new Response("Temporary blip", { status: 503 });
    }) as typeof fetch;

    // Very short budget: 30ms. After attempt 1, backoff + attempt cannot complete within budget.
    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetchSlow,
      retryDelaysMs: [500, 500],
      timeoutMs: 30
    });

    await expect(
      extractor.extract({
        fileName: "test.png",
        bytes: new Uint8Array([1]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("AI_PROVIDER_TIMEOUT");

    expect(callCount).toBeLessThan(3);
  });

  it("converts multi-page PDF into multiple image_url parts in the same vision request", async () => {
    let capturedBody: any = null;
    const mockFetch = (async (_url: any, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify({ courses: [], issues: [] }) }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const fakeRasterizer = async (): Promise<RasterizedImage[]> => [
      {
        bytes: new Uint8Array([10, 20]),
        mimeType: "image/png",
        width: 100,
        height: 100,
        pageNumber: 1
      },
      {
        bytes: new Uint8Array([30, 40]),
        mimeType: "image/png",
        width: 100,
        height: 100,
        pageNumber: 2
      }
    ];

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch,
      pdfRasterizerFn: fakeRasterizer
    });

    await extractor.extract({
      fileName: "schedule.pdf",
      bytes: new Uint8Array([0, 1, 2]),
      mimeType: "application/pdf"
    });

    const userContent = capturedBody.messages[1].content;
    expect(userContent).toHaveLength(3); // 1 text + 2 pages
    expect(userContent[0].type).toBe("text");
    expect(userContent[1].type).toBe("image_url");
    expect(userContent[2].type).toBe("image_url");

    expect(userContent[1].image_url.url).toContain(Buffer.from([10, 20]).toString("base64"));
    expect(userContent[2].image_url.url).toContain(Buffer.from([30, 40]).toString("base64"));
  });

  it("maps PDF page limit error to AI_INVALID_INPUT_PDF_PAGE_LIMIT", async () => {
    const errorRasterizer = async (): Promise<RasterizedImage[]> => {
      throw new Error("PDF_PAGE_LIMIT_EXCEEDED");
    };

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      pdfRasterizerFn: errorRasterizer
    });

    await expect(
      extractor.extract({
        fileName: "long.pdf",
        bytes: new Uint8Array([1]),
        mimeType: "application/pdf"
      })
    ).rejects.toThrow("AI_INVALID_INPUT_PDF_PAGE_LIMIT");
  });

  it("maps PDF pixel limit error to AI_INVALID_INPUT_PDF_TOO_LARGE", async () => {
    const errorRasterizer = async (): Promise<RasterizedImage[]> => {
      throw new Error("PDF_PIXEL_LIMIT_EXCEEDED");
    };

    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      pdfRasterizerFn: errorRasterizer
    });

    await expect(
      extractor.extract({
        fileName: "huge.pdf",
        bytes: new Uint8Array([1]),
        mimeType: "application/pdf"
      })
    ).rejects.toThrow("AI_INVALID_INPUT_PDF_TOO_LARGE");
  });

  it("rejects rasterized PDF when cumulative payload exceeds maxOutboundPayloadBytes with AI_INVALID_INPUT_PAYLOAD_TOO_LARGE", async () => {
    const bloatedRasterizer = async (): Promise<RasterizedImage[]> => [
      {
        bytes: new Uint8Array(600),
        mimeType: "image/png",
        width: 100,
        height: 100,
        pageNumber: 1
      },
      {
        bytes: new Uint8Array(600),
        mimeType: "image/png",
        width: 100,
        height: 100,
        pageNumber: 2
      }
    ];

    // Total = 1200 bytes, limit = 1000 bytes
    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      pdfRasterizerFn: bloatedRasterizer,
      maxOutboundPayloadBytes: 1000
    });

    await expect(
      extractor.extract({
        fileName: "schedule.pdf",
        bytes: new Uint8Array([1]),
        mimeType: "application/pdf"
      })
    ).rejects.toThrow("AI_INVALID_INPUT_PAYLOAD_TOO_LARGE");
  });

  it("rejects image upload when byte size exceeds maxOutboundPayloadBytes with AI_INVALID_INPUT_PAYLOAD_TOO_LARGE", async () => {
    const extractor = new XKiroScheduleExtractor({
      apiKey: "test-key",
      maxOutboundPayloadBytes: 100
    });

    await expect(
      extractor.extract({
        fileName: "big.png",
        bytes: new Uint8Array(150),
        mimeType: "image/png"
      })
    ).rejects.toThrow("AI_INVALID_INPUT_PAYLOAD_TOO_LARGE");
  });

  it("never exposes the API key in error messages or thrown errors", async () => {
    const secretKey = "super-secret-xkiro-key-999";
    const mockFetch = (async () => {
      return new Response("Invalid key", { status: 401 });
    }) as typeof fetch;

    const extractor = new XKiroScheduleExtractor({
      apiKey: secretKey,
      fetchFn: mockFetch
    });

    try {
      await extractor.extract({
        fileName: "test.png",
        bytes: new Uint8Array([1]),
        mimeType: "image/png"
      });
      expect.fail("Expected error was not thrown");
    } catch (err: any) {
      expect(err.message).not.toContain(secretKey);
    }
  });

  it("resolveProviderTimeoutMs honors AI_PROVIDER_TIMEOUT_MS and clamps to safe max", () => {
    expect(resolveProviderTimeoutMs()).toBe(50_000);

    process.env.AI_PROVIDER_TIMEOUT_MS = "45000";
    expect(resolveProviderTimeoutMs()).toBe(45_000);

    // Excessively high timeout clamped to 58_000 to protect Vercel 60s hard limit
    process.env.AI_PROVIDER_TIMEOUT_MS = "120000";
    expect(resolveProviderTimeoutMs()).toBe(58_000);
  });
});
