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

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
export const MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_AI_PROVIDER_TIMEOUT_MS = 50_000;
export const MAX_ALLOWED_TIMEOUT_MS = 58_000;

export function resolveProviderTimeoutMs(optionMs?: number): number {
  if (typeof optionMs === "number" && Number.isFinite(optionMs) && optionMs > 0) {
    return Math.min(optionMs, MAX_ALLOWED_TIMEOUT_MS);
  }

  const raw = process.env.AI_PROVIDER_TIMEOUT_MS;
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(parsed, MAX_ALLOWED_TIMEOUT_MS);
    }
  }

  return DEFAULT_AI_PROVIDER_TIMEOUT_MS;
}

function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("AI_PROVIDER_TIMEOUT"));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("AI_PROVIDER_TIMEOUT"));
    };

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function cleanModelOutput(raw: string): string {
  const trimmed = raw.trim();
  const fenceRegex = /^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i;
  const match = fenceRegex.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

export class GeminiScheduleExtractor implements ScheduleExtractor {
  private readonly apiKey: string;
  public readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelays: number[];

  constructor(options?: GeminiExtractorOptions) {
    this.apiKey = options?.apiKey || process.env.GEMINI_API_KEY || "";
    this.model = options?.model || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    this.timeoutMs = resolveProviderTimeoutMs(options?.timeoutMs);
    this.fetchImpl = options?.fetchFn || fetch;
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
    const supportedMimeTypes = new Set([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf"
    ]);

    if (!supportedMimeTypes.has(mimeType)) {
      throw new Error("GEMINI_INVALID_INPUT");
    }

    const base64Data = Buffer.from(input.bytes).toString("base64");
    const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(this.model)}:generateContent`;
    const deadline = Date.now() + this.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    const requestBody = JSON.stringify({
      systemInstruction: {
        parts: [{ text: SCHEDULE_EXTRACTION_SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: "user",
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
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 1500 || controller.signal.aborted) {
          throw new Error("AI_PROVIDER_TIMEOUT");
        }

        if (attempt > 0) {
          const baseDelay = this.retryDelays[attempt - 1] ?? attempt * 1000;
          const jitter = Math.floor(Math.random() * 200);
          const waitMs = baseDelay + jitter;

          if (Date.now() + waitMs + 1500 >= deadline) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }

          await sleepWithSignal(waitMs, controller.signal);
        }

        let response: Response;
        try {
          response = await this.fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": this.apiKey
            },
            signal: controller.signal,
            body: requestBody
          });
        } catch (fetchError: any) {
          if (fetchError?.name === "AbortError" || controller.signal.aborted) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }

          if (attempt < MAX_RETRY_ATTEMPTS - 1 && Date.now() + 3000 < deadline) {
            continue;
          }

          throw new Error("GEMINI_SERVICE_UNAVAILABLE");
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error(
            `Gemini API error (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}):`,
            response.status,
            errorText
          );

          if (response.status === 401 || response.status === 403) {
            throw new Error("GEMINI_API_INVALID_KEY");
          }
          if (response.status === 404) {
            throw new Error("GEMINI_MODEL_UNAVAILABLE");
          }
          if (response.status === 400) {
            throw new Error("GEMINI_INVALID_INPUT");
          }

          if (
            RETRYABLE_STATUS_CODES.has(response.status) &&
            attempt < MAX_RETRY_ATTEMPTS - 1 &&
            Date.now() + 3000 < deadline
          ) {
            continue;
          }

          if (response.status === 429) {
            throw new Error("GEMINI_RATE_LIMITED");
          }
          if (response.status === 408) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }
          if ([500, 502, 503, 504].includes(response.status)) {
            throw new Error("GEMINI_SERVICE_UNAVAILABLE");
          }

          throw new Error("GEMINI_SERVICE_UNAVAILABLE");
        }

        const data = (await response.json()) as any;
        const finishReason = data?.candidates?.[0]?.finishReason;
        if (finishReason === "MAX_TOKENS") {
          throw new Error("AI_INVALID_RESPONSE");
        }

        const textResponse = data?.candidates?.[0]?.content?.parts
          ?.map((part: any) => (typeof part?.text === "string" ? part.text : ""))
          .join("")
          .trim();

        if (!textResponse) {
          throw new Error("EMPTY_AI_RESPONSE");
        }

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(cleanModelOutput(textResponse));
        } catch {
          throw new Error("INVALID_JSON_FROM_AI");
        }

        const validated = RawExtractionResponseSchema.safeParse(parsedJson);
        if (!validated.success) {
          console.warn("Gemini raw extraction parse issue:", validated.error);
          const fallbackRaw = {
            courses: Array.isArray((parsedJson as any)?.courses)
              ? (parsedJson as any).courses
              : [],
            issues: [
              {
                field: "ai_parsing",
                message:
                  "بعض حقول الجدول لم تأتِ بالشكل المتوقع تماماً وتم تصحيحها تلقائياً.",
                severity: "info" as const
              }
            ]
          };
          return normalizeExtractionResult(fallbackRaw);
        }

        return normalizeExtractionResult(validated.data);
      }

      throw new Error("GEMINI_SERVICE_UNAVAILABLE");
    } catch (error: any) {
      if (error?.name === "AbortError" || controller.signal.aborted) {
        throw new Error("AI_PROVIDER_TIMEOUT");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
