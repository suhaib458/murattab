import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeExtractionRateLimit,
  createExtractionCacheKey,
  resetAiUsageGuardForTests,
  runCachedExtraction
} from "@/server/ai/usage-guard";

describe("AI usage guard", () => {
  beforeEach(() => {
    resetAiUsageGuardForTests();
    delete process.env.AI_CLIENT_RATE_LIMIT_REQUESTS;
    delete process.env.AI_CLIENT_RATE_LIMIT_WINDOW_MS;
    delete process.env.AI_GLOBAL_RATE_LIMIT_REQUESTS;
    delete process.env.AI_GLOBAL_RATE_LIMIT_WINDOW_MS;
    delete process.env.AI_RESULT_CACHE_TTL_MS;
    delete process.env.AI_RESULT_CACHE_MAX_ENTRIES;
  });

  it("limits repeated fresh analyses from the same anonymous client", () => {
    const now = 1_000_000;

    expect(consumeExtractionRateLimit("client-a", now).allowed).toBe(true);
    expect(consumeExtractionRateLimit("client-a", now + 1).allowed).toBe(true);
    expect(consumeExtractionRateLimit("client-a", now + 2).allowed).toBe(true);

    const blocked = consumeExtractionRateLimit("client-a", now + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe("client");
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps fresh extraction bursts below the provider RPM guard", () => {
    const now = 2_000_000;

    expect(consumeExtractionRateLimit("client-a", now).allowed).toBe(true);
    expect(consumeExtractionRateLimit("client-b", now).allowed).toBe(true);
    expect(consumeExtractionRateLimit("client-c", now).allowed).toBe(true);
    expect(consumeExtractionRateLimit("client-d", now).allowed).toBe(true);

    const blocked = consumeExtractionRateLimit("client-e", now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.scope).toBe("global");
  });

  it("returns a cached result for the exact same file without running the loader again", async () => {
    const key = createExtractionCacheKey(new Uint8Array([1, 2, 3]), "image/png");
    let loaderCalls = 0;

    const first = await runCachedExtraction(key, async () => {
      loaderCalls += 1;
      return { courses: ["networks"] };
    });

    const second = await runCachedExtraction(key, async () => {
      loaderCalls += 1;
      return { courses: ["should-not-run"] };
    });

    expect(first.source).toBe("miss");
    expect(second.source).toBe("hit");
    expect(second.result).toEqual({ courses: ["networks"] });
    expect(loaderCalls).toBe(1);
  });

  it("coalesces simultaneous requests for the same file into one provider call", async () => {
    const key = createExtractionCacheKey(new Uint8Array([9, 8, 7]), "application/pdf");
    let loaderCalls = 0;
    let release!: (value: { ok: boolean }) => void;

    const pending = new Promise<{ ok: boolean }>((resolve) => {
      release = resolve;
    });

    const firstPromise = runCachedExtraction(key, async () => {
      loaderCalls += 1;
      return pending;
    });

    const secondPromise = runCachedExtraction(key, async () => {
      loaderCalls += 1;
      return { ok: false };
    });

    release({ ok: true });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.source).toBe("miss");
    expect(second.source).toBe("coalesced");
    expect(first.result).toEqual({ ok: true });
    expect(second.result).toEqual({ ok: true });
    expect(loaderCalls).toBe(1);
  });
});
