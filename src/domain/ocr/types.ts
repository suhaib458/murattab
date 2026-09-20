/**
 * Murattab-owned OCR types.
 *
 * These types form the stable contract for local OCR results.
 * No Tesseract.js internal types leak outside this module —
 * all OCR consumers depend on these normalized interfaces.
 */

// ── Spatial data ───────────────────────────────────────────────────────

/**
 * Axis-aligned bounding box in ORIGINAL uploaded image-pixel coordinates.
 *
 * Contract:
 * All bounding boxes (`OcrWord.bbox`, `OcrLine.bbox`) exposed by Murattab use the
 * coordinate system of the original uploaded image (`width` × `height`), NOT any
 * scaled/preprocessed intermediate representation.
 *
 * Coordinates are mapped back from Tesseract's preprocessed space via:
 *   scaleX = originalWidth / processedWidth
 *   scaleY = originalHeight / processedHeight
 * and rounded to integer pixel coordinates (`Math.round`).
 */
export interface OcrBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ── Recognition output ─────────────────────────────────────────────────

export interface OcrWord {
  text: string;
  /** Confidence score, normalized to 0–1 (0 = no confidence, 1 = full). */
  confidence: number;
  bbox: OcrBoundingBox;
}

export interface OcrLine {
  text: string;
  /** Confidence score, normalized to 0–1. */
  confidence: number;
  bbox: OcrBoundingBox;
  words: OcrWord[];
}

/**
 * Complete OCR result for a single image.
 * Contains the full recognized text plus spatial/word/line breakdown.
 */
export interface OcrImageResult {
  /** Full recognized text (all lines concatenated). */
  text: string;
  /** Overall confidence score, normalized to 0–1. */
  confidence: number;
  /** Original image width in pixels. */
  width: number;
  /** Original image height in pixels. */
  height: number;
  words: OcrWord[];
  lines: OcrLine[];
}

// ── Error contract ─────────────────────────────────────────────────────

/**
 * Provider-neutral OCR error codes.
 * These are NOT reused from AI provider errors (xKiro/Gemini).
 */
export type OcrErrorCode =
  | "OCR_IMAGE_DECODE_FAILED"
  | "OCR_INITIALIZATION_FAILED"
  | "OCR_RECOGNITION_FAILED"
  | "OCR_UNSUPPORTED_IMAGE"
  | "OCR_IMAGE_TOO_LARGE";

export class OcrError extends Error {
  override readonly name = "OcrError";

  constructor(
    public readonly code: OcrErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

// ── Preprocessing output ───────────────────────────────────────────────

/**
 * Result of the image preprocessing pipeline.
 * Contains the processed pixel data ready for OCR plus original dimensions.
 */
export interface PreprocessedImage {
  /** Processed image as a Blob (PNG) ready for Tesseract. */
  blob: Blob;
  /** Original image width before any preprocessing. */
  originalWidth: number;
  /** Original image height before any preprocessing. */
  originalHeight: number;
  /** Processed/scaled image width as fed to Tesseract. */
  processedWidth: number;
  /** Processed/scaled image height as fed to Tesseract. */
  processedHeight: number;
}
