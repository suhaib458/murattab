import { z } from "zod";
import { ExtractionIssueSchema } from "../models";

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf"
] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

export function isSupportedMimeType(mime: string): mime is SupportedMimeType {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

export function validateUploadFile(file: { size: number; type: string }): { valid: boolean; error?: string } {
  if (!isSupportedMimeType(file.type)) {
    return {
      valid: false,
      error: "نوع الملف غير مدعوم. الصيغ المدعومة هي: JPG، PNG، WebP، و PDF فقط."
    };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: "حجم الملف يتجاوز الحد الأقصى المسموح به وهو 10 ميجابايت."
    };
  }
  return { valid: true };
}

export const ConfidenceScoreSchema = z.number().min(0).max(1);

export const RawSessionExtractionSchema = z.object({
  day: z.string().default(""),
  startsAt: z.string().default(""),
  endsAt: z.string().default(""),
  room: z.string().default(""),
  kind: z.enum(["lecture", "lab", "unspecified"]).default("unspecified"),
  confidence: z.object({
    day: ConfidenceScoreSchema.default(0.9),
    time: ConfidenceScoreSchema.default(0.9),
    room: ConfidenceScoreSchema.default(0.9)
  }).default({ day: 0.9, time: 0.9, room: 0.9 })
});

export const RawCourseExtractionSchema = z.object({
  courseName: z.string().min(1),
  nameConfidence: ConfidenceScoreSchema.default(0.9),
  sessions: z.array(RawSessionExtractionSchema).default([])
});

export const RawExtractionResponseSchema = z.object({
  courses: z.array(RawCourseExtractionSchema).default([]),
  issues: z.array(ExtractionIssueSchema).default([])
});

export type RawSessionExtraction = z.infer<typeof RawSessionExtractionSchema>;
export type RawCourseExtraction = z.infer<typeof RawCourseExtractionSchema>;
export type RawExtractionResponse = z.infer<typeof RawExtractionResponseSchema>;
