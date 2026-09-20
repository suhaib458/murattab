/**
 * OCR domain barrel export.
 *
 * Only types and pure utilities are re-exported here.
 * These are safe for server-side import (no browser APIs).
 *
 * To use the Tesseract engine (browser-only), import directly:
 *
 *   import { LocalOcrEngine } from "@/domain/ocr/tesseract-engine";
 *
 * Do NOT import LocalOcrEngine from this barrel — it depends on
 * browser-only APIs (Worker, Canvas, OffscreenCanvas) that will
 * break in Server Components or Node.js environments.
 */

// ── Types (safe for any environment) ───────────────────────────────────
export type {
  OcrBoundingBox,
  OcrWord,
  OcrLine,
  OcrImageResult,
  OcrErrorCode,
  PreprocessedImage,
} from "./types";

export { OcrError } from "./types";

// ── Pure utilities (safe for any environment) ──────────────────────────
export {
  computeScaleFactor,
  toGreyscale,
  enhanceContrast,
  MIN_USEFUL_WIDTH,
  MAX_DIMENSION,
  MAX_TOTAL_PIXELS,
} from "./image-preprocessor";
