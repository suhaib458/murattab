import type { ScheduleExtractionResult, ScheduleExtractor } from "../models";
import { RawExtractionResponseSchema } from "./extraction-schema";
import { normalizeExtractionResult } from "./normalizer";
import { SCHEDULE_EXTRACTION_SYSTEM_PROMPT, SCHEDULE_EXTRACTION_USER_PROMPT } from "./prompt";

export interface GeminiExtractorOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  retryDelaysMs?: number[];
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";
export const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
export const MAX_RETRY_ATTEMPTS = 3;

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
    this.timeoutMs = options?.timeoutMs || 30000;
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
          if (fetchErr.name === "AbortError" || controller.signal.aborted) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }
          if (attempt < MAX_RETRY_ATTEMPTS - 1) {
            console.warn(`Gemini network error (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}), retrying...`, fetchErr);
            continue;
          }
          throw fetchErr;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error(`Gemini API error (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}):`, response.status, errorText);

          // Non-retryable errors
          if (response.status === 401 || response.status === 403) {
            throw new Error("GEMINI_API_INVALID_KEY");
          }
          if (response.status === 404) {
            throw new Error("GEMINI_MODEL_UNAVAILABLE");
          }
          if (response.status === 400) {
            throw new Error("GEMINI_INVALID_INPUT");
          }

          // If retryable and attempts remain, retry next attempt
          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < MAX_RETRY_ATTEMPTS - 1) {
            continue;
          }

          // Retries exhausted or non-retryable status
          if (response.status === 503 || response.status === 500 || response.status === 502 || response.status === 504) {
            throw new Error("GEMINI_SERVICE_UNAVAILABLE");
          }
          if (response.status === 429) {
            throw new Error("GEMINI_RATE_LIMITED");
          }
          if (response.status === 408) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }
          throw new Error(`GEMINI_API_ERROR_${response.status}`);
        }

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

      throw new Error("GEMINI_SERVICE_UNAVAILABLE");
    } catch (err: any) {
      if (err.name === "AbortError" || controller.signal.aborted) {
        throw new Error("AI_PROVIDER_TIMEOUT");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
