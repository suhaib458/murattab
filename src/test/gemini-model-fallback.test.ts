import { describe, expect, it } from "vitest";
import {
  DEFAULT_GEMINI_FALLBACK_MODELS,
  DEFAULT_GEMINI_MODEL,
  GeminiScheduleExtractor
} from "@/domain/ai/gemini-extractor";

describe("Gemini schedule extraction - model failover", () => {
  it("fails over from 3.8 to 3.7 to 3.6 on transient 503 responses", async () => {
    const requestedUrls: string[] = [];

    const mockFetch = (async (url: string | URL | Request) => {
      requestedUrls.push(url.toString());

      if (requestedUrls.length < 3) {
        return new Response(
          JSON.stringify({
            error: {
              code: 503,
              status: "UNAVAILABLE",
              message: "This model is currently experiencing high demand."
            }
          }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
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
      fetchFn: mockFetch,
      retryDelaysMs: [1, 1],
      timeoutMs: 60_000
    });

    const result = await extractor.extract({
      fileName: "schedule.png",
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png"
    });

    expect(requestedUrls).toHaveLength(3);
    expect(requestedUrls[0]).toContain(`models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(requestedUrls[1]).toContain(
      `models/${DEFAULT_GEMINI_FALLBACK_MODELS[0]}:generateContent`
    );
    expect(requestedUrls[2]).toContain(
      `models/${DEFAULT_GEMINI_FALLBACK_MODELS[1]}:generateContent`
    );
    expect(result.draft.courses).toEqual([]);
  });

  it("does not fail over for non-retryable client errors", async () => {
    let callCount = 0;
    const mockFetch = (async () => {
      callCount += 1;
      return new Response("Bad request", { status: 400 });
    }) as typeof fetch;

    const extractor = new GeminiScheduleExtractor({
      apiKey: "test-key",
      fetchFn: mockFetch,
      retryDelaysMs: [1, 1]
    });

    await expect(
      extractor.extract({
        fileName: "schedule.png",
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/png"
      })
    ).rejects.toThrow("GEMINI_INVALID_INPUT");

    expect(callCount).toBe(1);
  });
});
