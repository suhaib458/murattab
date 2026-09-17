import type { ScheduleExtractionResult, ScheduleExtractor } from "../models";
import { RawExtractionResponseSchema } from "./extraction-schema";
import { normalizeExtractionResult } from "./normalizer";
import { SCHEDULE_EXTRACTION_SYSTEM_PROMPT, SCHEDULE_EXTRACTION_USER_PROMPT } from "./prompt";

export interface GeminiExtractorOptions {
  apiKey?: string;
  model?: string;
  /**
   * Overall budget for the whole `extract()` call — covers all attempts AND
   * the inter-attempt backoff sleeps. Default: read from `AI_PROVIDER_TIMEOUT_MS`
   * env var; falls back to 60_000 ms.
   *
   * This budget is intentionally larger than any single HTTP request so the
   * full 3-attempt retry policy can actually run. Repeated 503/429 responses
   * on the final attempt are still classified as `GEMINI_SERVICE_UNAVAILABLE`
   * (not `AI_PROVIDER_TIMEOUT`) so the route can return the correct status.
   */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  retryDelaysMs?: number[];
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
export const MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_AI_PROVIDER_TIMEOUT_MS = 60_000;

/**
 * Resolve the overall extraction timeout in milliseconds.
 * Precedence: explicit option > `AI_PROVIDER_TIMEOUT_MS` env var > 60_000 default.
 *
 * Server-only: the value is read from process.env at construction time and
 * never exposed to the client bundle.
 */
export function resolveProviderTimeoutMs(optionMs?: number): number {
  if (typeof optionMs === "number" && Number.isFinite(optionMs) && optionMs > 0) {
    return optionMs;
  }
  const raw = process.env.AI_PROVIDER_TIMEOUT_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_AI_PROVIDER_TIMEOUT_MS;
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("AI_PROVIDER_TIMEOUT"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("AI_PROVIDER_TIMEOUT"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class GeminiScheduleExtractor implements ScheduleExtractor {
  private apiKey: string;
  public readonly model: string;
  private timeoutMs: number;
  private fetch: typeof fetch;
  private retryDelays: number[];

  constructor(options?: GeminiExtractorOptions) {
    this.apiKey = options?.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options?.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    this.timeoutMs = resolveProviderTimeoutMs(options?.timeoutMs);
    this.fetch = options?.fetchFn || fetch;
    this.retryDelays = options?.retryDelaysMs ?? [1000, 2000];
  }

  async extract(input: {
    fileName: string;
    bytes: Uint8Array;
    mimeType?: string;
  }): Promise<ScheduleExtractionResult> {
    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY_MISSING");
    }

    const mimeType = input.mimeType || "image/jpeg";
    const base64Data = Buffer.from(input.bytes).toString("base64");

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    // Global AbortController — bound to the overall extraction budget
    // (default 60s, configurable via AI_PROVIDER_TIMEOUT_MS). It must be
    // long enough for all 3 attempts + their inter-attempt sleeps so that
    // 3 consecutive 503s are classified as GEMINI_SERVICE_UNAVAILABLE, not
    // as a premature AI_PROVIDER_TIMEOUT.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [{ text: SCHEDULE_EXTRACTION_SYSTEM_PROMPT }]
      },
      contents: [
        {
          parts: [
            { text: SCHEDULE_EXTRACTION_USER_PROMPT },
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1
      }
    });

    // Track whether a fetch was aborted specifically by the global timeout
    // (so a 3rd-attempt 503 doesn't get re-classified as a timeout on
    // microtask scheduling artifacts). A timeout-induced abort is a hard
    // signal: the operation really did exceed the budget.
    let timedOut = false;
    controller.signal.addEventListener("abort", () => {
      // We only mark "timed out" once the timer has actually fired.
      // User-initiated aborts propagate the same way; both are treated as
      // AI_PROVIDER_TIMEOUT at the route level.
      timedOut = true;
    });

    try {
      for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
        if (controller.signal.aborted) {
          throw new Error("AI_PROVIDER_TIMEOUT");
        }

        if (attempt > 0) {
          const baseDelay = this.retryDelays[attempt - 1] ?? (attempt * 1000);
          const jitter = Math.floor(Math.random() * 200);
          await sleepWithSignal(baseDelay + jitter, controller.signal);
        }

        let response: Response;
        try {
          response = await this.fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: requestBody
          });
        } catch (fetchErr: any) {
          // AbortError (user cancel OR global timeout firing while fetch
          // was in flight) is a real timeout — the request never completed.
          if (fetchErr?.name === "AbortError" || controller.signal.aborted) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }
          // Any other network error is treated as transient and retried
          // if attempts remain. If we've exhausted attempts, propagate the
          // raw error so the route can surface it as 500.
          if (attempt < MAX_RETRY_ATTEMPTS - 1) {
            console.warn(`Gemini network error (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}), retrying...`, fetchErr);
            continue;
          }
          throw fetchErr;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error(`Gemini API error (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}):`, response.status, errorText);

          // Non-retryable errors — abort immediately with the precise cause.
          if (response.status === 401 || response.status === 403) {
            throw new Error("GEMINI_API_INVALID_KEY");
          }
          if (response.status === 404) {
            throw new Error("GEMINI_MODEL_UNAVAILABLE");
          }
          if (response.status === 400) {
            throw new Error("GEMINI_INVALID_INPUT");
          }

          // Retryable: 408, 429, 500, 502, 503, 504
          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRY_ATTEMPTS - 1) {
            // Important: do NOT classify as AI_PROVIDER_TIMEOUT here. A
            // completed 503 on the last attempt is GEMINI_SERVICE_UNAVAILABLE.
            continue;
          }

          // Retries exhausted — classify by the status the provider actually
          // returned, so the route returns the right HTTP code.
          if (response.status === 429) {
            throw new Error("GEMINI_RATE_LIMITED");
          }
          if (response.status === 408) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }
          if (response.status === 500 || response.status === 502 || response.status === 503 || response.status === 504) {
            throw new Error("GEMINI_SERVICE_UNAVAILABLE");
          }
          throw new Error(`GEMINI_API_ERROR_${response.status}`);
        }

        // Successful response — parse and return.
        const data = (await response.json()) as any;
        const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textResponse) {
          throw new Error("EMPTY_AI_RESPONSE");
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(textResponse);
        } catch {
          throw new Error("INVALID_JSON_FROM_AI");
        }

        const validated = RawExtractionResponseSchema.safeParse(parsedJson);
        if (!validated.success) {
          console.warn("Zod raw extraction parse issue:", validated.error);
          const fallbackRaw = {
            courses: Array.isArray((parsedJson as any)?.courses) ? (parsedJson as any).courses : [],
            issues: [
              {
                field: "ai_parsing",
                message: "بعض حقول الجدول لم تأتِ بالشكل المتوقع تماماً وتم تصحيحها تلقائياً.",
                severity: "info" as const
              }
            ]
          };
          return normalizeExtractionResult(fallbackRaw);
        }

        return normalizeExtractionResult(validated.data);
      }

      // The loop only exits via `throw` above. If we get here, treat as
      // service-unavailable so 3 completed retryable failures surface as
      // 503, not 504.
      throw new Error("GEMINI_SERVICE_UNAVAILABLE");
    } catch (err: any) {
      // An AbortError that escaped the per-attempt catch (e.g. thrown by
      // `response.json()` after the controller was aborted) is a real
      // timeout — the operation did not complete in time.
      if (err?.name === "AbortError" || (controller.signal.aborted && timedOut)) {
        throw new Error("AI_PROVIDER_TIMEOUT");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
