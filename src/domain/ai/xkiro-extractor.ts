import type { ScheduleExtractionResult, ScheduleExtractor } from "../models";
import { RawExtractionResponseSchema } from "./extraction-schema";
import { normalizeExtractionResult } from "./normalizer";
import { SCHEDULE_EXTRACTION_SYSTEM_PROMPT, SCHEDULE_EXTRACTION_USER_PROMPT } from "./prompt";
import { rasterizePdfToImages, type RasterizedImage } from "./pdf-rasterizer";

export interface XKiroExtractorOptions {
  apiKey?: string;
  model?: string;
  /**
   * Overall total budget for the whole `extract()` call (ms) — covers PDF
   * rasterization, all attempts, AND inter-attempt backoff sleeps.
   * Strictly bounded below Vercel's 60s hard limit.
   * Default: read from `AI_PROVIDER_TIMEOUT_MS` env var; falls back to 50_000 ms.
   */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  retryDelaysMs?: number[];
  pdfRasterizerFn?: (
    bytes: Uint8Array,
    options?: { signal?: AbortSignal }
  ) => Promise<RasterizedImage[]>;
  /**
   * Internal Murattab safety limit for the cumulative rasterized image payload (bytes).
   * Guards against transmitting unexpectedly bloated rasterized payloads upstream.
   * Note: This is an internal application safety guard, not an upstream xKiro API limit.
   */
  maxOutboundPayloadBytes?: number;
}

export const DEFAULT_XKIRO_MODEL = "qwen/qwen3.8-omni-flash:free";
export const XKIRO_API_ENDPOINT = "https://api.xkiro.com/v1/chat/completions";
export const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
export const MAX_RETRY_ATTEMPTS = 3;
export const DEFAULT_AI_PROVIDER_TIMEOUT_MS = 50_000;
export const MAX_ALLOWED_TIMEOUT_MS = 58_000;
/**
 * Internal Murattab safety limit for cumulative outbound image payload (bytes).
 * Default 10 MB. Protects against unexpectedly bloated rasterized payloads.
 * This is an internal Murattab safety limit, not an official upstream xKiro limit.
 */
export const MAX_OUTBOUND_IMAGE_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export function resolveProviderTimeoutMs(optionMs?: number): number {
  if (typeof optionMs === "number" && Number.isFinite(optionMs) && optionMs > 0) {
    return Math.min(optionMs, MAX_ALLOWED_TIMEOUT_MS);
  }
  const raw = process.env.AI_PROVIDER_TIMEOUT_MS;
  if (raw) {
    const parsed = parseInt(raw, 10);
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

function cleanModelOutput(raw: string): string {
  const trimmed = raw.trim();
  const fenceRegex = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
  const match = fenceRegex.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

export class XKiroScheduleExtractor implements ScheduleExtractor {
  private apiKey: string;
  public readonly model: string;
  private timeoutMs: number;
  private fetch: typeof fetch;
  private retryDelays: number[];
  private pdfRasterizer: (
    bytes: Uint8Array,
    options?: { signal?: AbortSignal }
  ) => Promise<RasterizedImage[]>;
  private maxOutboundPayloadBytes: number;

  constructor(options?: XKiroExtractorOptions) {
    this.apiKey = options?.apiKey || process.env.XKIRO_API_KEY || "";
    this.model = options?.model || process.env.XKIRO_MODEL || DEFAULT_XKIRO_MODEL;
    this.timeoutMs = resolveProviderTimeoutMs(options?.timeoutMs);
    this.fetch = options?.fetchFn || fetch;
    this.retryDelays = options?.retryDelaysMs ?? [1000, 2000];
    this.pdfRasterizer = options?.pdfRasterizerFn || rasterizePdfToImages;
    this.maxOutboundPayloadBytes =
      options?.maxOutboundPayloadBytes ?? MAX_OUTBOUND_IMAGE_PAYLOAD_BYTES;
  }

  async extract(input: {
    fileName: string;
    bytes: Uint8Array;
    mimeType?: string;
  }): Promise<ScheduleExtractionResult> {
    if (!this.apiKey) {
      throw new Error("AI_API_KEY_MISSING");
    }

    const mimeType = input.mimeType || "image/jpeg";
    const deadline = Date.now() + this.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      // 1. Prepare image contents
      let userMessageContent: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;

      if (mimeType === "application/pdf") {
        let rasterizedPages: RasterizedImage[];
        try {
          rasterizedPages = await this.pdfRasterizer(input.bytes, {
            signal: controller.signal
          });
        } catch (pdfErr: any) {
          if (pdfErr?.message === "AI_PROVIDER_TIMEOUT" || controller.signal.aborted) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }
          if (pdfErr?.message === "PDF_PAGE_LIMIT_EXCEEDED") {
            throw new Error("AI_INVALID_INPUT_PDF_PAGE_LIMIT");
          }
          if (pdfErr?.message === "PDF_PIXEL_LIMIT_EXCEEDED") {
            throw new Error("AI_INVALID_INPUT_PDF_TOO_LARGE");
          }
          throw new Error("AI_INVALID_INPUT");
        }

        if (rasterizedPages.length === 0) {
          throw new Error("AI_INVALID_INPUT");
        }

        const totalRasterizedBytes = rasterizedPages.reduce(
          (acc, page) => acc + page.bytes.byteLength,
          0
        );

        // Internal Murattab safety limit: reject unexpectedly bloated rasterized payloads.
        // This is an application-level guard, not an upstream xKiro limit.
        if (totalRasterizedBytes > this.maxOutboundPayloadBytes) {
          throw new Error("AI_INVALID_INPUT_PAYLOAD_TOO_LARGE");
        }

        userMessageContent = [
          { type: "text", text: SCHEDULE_EXTRACTION_USER_PROMPT },
          ...rasterizedPages.map((page) => ({
            type: "image_url" as const,
            image_url: {
              url: `data:${page.mimeType};base64,${Buffer.from(page.bytes).toString("base64")}`
            }
          }))
        ];
      } else {
        const supportedImageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
        if (!supportedImageMimes.has(mimeType)) {
          throw new Error("AI_INVALID_INPUT");
        }

        if (input.bytes.byteLength > this.maxOutboundPayloadBytes) {
          throw new Error("AI_INVALID_INPUT_PAYLOAD_TOO_LARGE");
        }

        const base64Data = Buffer.from(input.bytes).toString("base64");
        userMessageContent = [
          { type: "text", text: SCHEDULE_EXTRACTION_USER_PROMPT },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Data}`
            }
          }
        ];
      }

      const requestBody = JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: SCHEDULE_EXTRACTION_SYSTEM_PROMPT
          },
          {
            role: "user",
            content: userMessageContent
          }
        ],
        response_format: {
          type: "json_object"
        },
        temperature: 0.1
      });

      // 2. Execute bounded retry loop under total request deadline
      for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 1500 || controller.signal.aborted) {
          throw new Error("AI_PROVIDER_TIMEOUT");
        }

        if (attempt > 0) {
          const baseDelay = this.retryDelays[attempt - 1] ?? attempt * 1000;
          const jitter = Math.floor(Math.random() * 200);
          const waitMs = baseDelay + jitter;

          if (Date.now() + waitMs + 2000 >= deadline) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }

          await sleepWithSignal(waitMs, controller.signal);
        }

        let response: Response;
        try {
          response = await this.fetch(XKIRO_API_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.apiKey}`
            },
            signal: controller.signal,
            body: requestBody
          });
        } catch (fetchErr: any) {
          if (fetchErr?.name === "AbortError" || controller.signal.aborted) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }
          if (attempt < MAX_RETRY_ATTEMPTS - 1 && Date.now() + 3000 < deadline) {
            console.warn(
              `xKiro network error (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}), retrying...`,
              fetchErr
            );
            continue;
          }
          throw new Error("AI_SERVICE_UNAVAILABLE");
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.error(
            `xKiro API error (attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}):`,
            response.status,
            errorText
          );

          if (response.status === 401 || response.status === 403) {
            throw new Error("AI_INVALID_KEY");
          }
          if (response.status === 404) {
            throw new Error("AI_MODEL_UNAVAILABLE");
          }
          if (response.status === 400) {
            throw new Error("AI_INVALID_INPUT");
          }

          if (
            RETRYABLE_STATUS_CODES.has(response.status) &&
            attempt < MAX_RETRY_ATTEMPTS - 1 &&
            Date.now() + 3000 < deadline
          ) {
            continue;
          }

          if (response.status === 429) {
            throw new Error("AI_RATE_LIMITED");
          }
          if (response.status === 408) {
            throw new Error("AI_PROVIDER_TIMEOUT");
          }
          if (
            response.status === 500 ||
            response.status === 502 ||
            response.status === 503 ||
            response.status === 504
          ) {
            throw new Error("AI_SERVICE_UNAVAILABLE");
          }
          throw new Error(`AI_SERVICE_UNAVAILABLE`);
        }

        const data = (await response.json()) as any;
        const choice = data?.choices?.[0];

        if (!choice) {
          throw new Error("EMPTY_AI_RESPONSE");
        }

        if (choice.finish_reason === "length") {
          throw new Error("AI_INVALID_RESPONSE");
        }

        const textResponse = choice?.message?.content;
        if (!textResponse || typeof textResponse !== "string" || !textResponse.trim()) {
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
          console.warn("Zod raw extraction parse issue:", validated.error);
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

      throw new Error("AI_SERVICE_UNAVAILABLE");
    } catch (err: any) {
      if (err?.name === "AbortError" || controller.signal.aborted) {
        throw new Error("AI_PROVIDER_TIMEOUT");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
