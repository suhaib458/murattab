/**
 * Local OCR engine powered by Tesseract.js.
 *
 * Browser-only module — uses Web Workers, Canvas, and Blob APIs.
 * Must be dynamically imported from client-side code only.
 *
 * Privacy guarantee:
 *   - The student's image never leaves the browser.
 *   - The only network activity is loading engine assets (WASM, traineddata)
 *     from the same origin (public/ocr/).
 *   - No API routes, server actions, or upload endpoints are created.
 *
 * Worker lifecycle:
 *   - Lazily initialized on first recognizeImage() call.
 *   - Single reusable worker for the session (no duplicate workers).
 *   - Concurrent calls during initialization share the same init promise.
 *   - dispose() terminates the worker and resets state.
 */

import type Tesseract from "tesseract.js";
import { OcrError } from "./types";
import type {
  OcrImageResult,
  OcrLine,
  OcrWord,
  OcrBoundingBox,
} from "./types";
import { preprocessImage } from "./image-preprocessor";

// ── Self-hosted asset paths ────────────────────────────────────────────
//
// All assets are served from the same origin under /ocr/.
// They are copied from node_modules at setup time by `pnpm ocr:setup`.

const OCR_WORKER_PATH = "/ocr/worker.min.js";
const OCR_CORE_PATH = "/ocr/core";
const OCR_LANG_PATH = "/ocr/lang";

/** Languages loaded: Arabic + English for TTU schedules (explicit array). */
const OCR_LANGUAGES: string[] = ["ara", "eng"];

// ── Result mapping ─────────────────────────────────────────────────────

/** Normalize Tesseract confidence (0–100) to Murattab convention (0–1). */
function normalizeConfidence(raw: number): number {
  return Math.max(0, Math.min(1, raw / 100));
}

/**
 * Map a Tesseract bounding box from preprocessed image space back to
 * the original uploaded image coordinate system.
 * Does not mutate the Tesseract input object.
 */
function mapBbox(bbox: Tesseract.Bbox, scaleX: number, scaleY: number): OcrBoundingBox {
  return {
    x0: Math.round(bbox.x0 * scaleX),
    y0: Math.round(bbox.y0 * scaleY),
    x1: Math.round(bbox.x1 * scaleX),
    y1: Math.round(bbox.y1 * scaleY),
  };
}

function mapWord(w: Tesseract.Word, scaleX: number, scaleY: number): OcrWord {
  return {
    text: w.text,
    confidence: normalizeConfidence(w.confidence),
    bbox: mapBbox(w.bbox, scaleX, scaleY),
  };
}

function mapLine(line: Tesseract.Line, scaleX: number, scaleY: number): OcrLine {
  return {
    text: line.text,
    confidence: normalizeConfidence(line.confidence),
    bbox: mapBbox(line.bbox, scaleX, scaleY),
    words: line.words
      .filter((w) => w.text.trim().length > 0)
      .map((w) => mapWord(w, scaleX, scaleY)),
  };
}

/**
 * Map the full Tesseract Page result into Murattab's OcrImageResult.
 *
 * All bounding boxes are transformed back to the original uploaded image coordinate
 * system via scaleX (originalWidth / processedWidth) and scaleY (originalHeight / processedHeight).
 *
 * Tesseract v7 returns structured data via blocks → paragraphs → lines → words
 * only when { blocks: true } is passed to recognize().
 */
export function mapTesseractResult(
  page: Tesseract.Page,
  originalWidth: number,
  originalHeight: number,
  processedWidth: number = originalWidth,
  processedHeight: number = originalHeight
): OcrImageResult {
  const scaleX = processedWidth > 0 ? originalWidth / processedWidth : 1;
  const scaleY = processedHeight > 0 ? originalHeight / processedHeight : 1;

  const lines: OcrLine[] = [];
  const words: OcrWord[] = [];

  if (page.blocks) {
    for (const block of page.blocks) {
      for (const paragraph of block.paragraphs) {
        for (const line of paragraph.lines) {
          const mappedLine = mapLine(line, scaleX, scaleY);
          lines.push(mappedLine);
          words.push(...mappedLine.words);
        }
      }
    }
  }

  return {
    text: page.text,
    confidence: normalizeConfidence(page.confidence),
    width: originalWidth,
    height: originalHeight,
    words,
    lines,
  };
}

// ── Engine class ───────────────────────────────────────────────────────

export class LocalOcrEngine {
  private worker: Tesseract.Worker | null = null;
  private initPromise: Promise<Tesseract.Worker> | null = null;
  private isDisposed = false;

  /**
   * Lazily initialize the Tesseract worker.
   * Concurrent calls share the same initialization promise —
   * no duplicate workers are spawned.
   */
  private getWorker(): Promise<Tesseract.Worker> {
    if (this.worker) return Promise.resolve(this.worker);

    if (this.initPromise) return this.initPromise;

    this.isDisposed = false;
    this.initPromise = this.createWorker();
    return this.initPromise;
  }

  private async createWorker(): Promise<Tesseract.Worker> {
    try {
      // Dynamic import so this module is never accidentally bundled server-side
      const { createWorker, OEM } = await import("tesseract.js");

      // Explicitly set OEM to LSTM_ONLY matching our self-hosted LSTM-only WASM core
      const worker = await createWorker(OCR_LANGUAGES, OEM.LSTM_ONLY, {
        workerPath: OCR_WORKER_PATH,
        corePath: OCR_CORE_PATH,
        langPath: OCR_LANG_PATH,
        workerBlobURL: true,
        gzip: true,
      });

      // PSM 4 (SINGLE_COLUMN): Assumes a single vertical column of text of variable sizes,
      // which strictly matches schedule tables and guarantees sequential top-to-bottom row recognition.
      await worker.setParameters({ tessedit_pageseg_mode: "4" as any });

      if (this.isDisposed) {
        await worker.terminate().catch(() => {});
        throw new OcrError("OCR_INITIALIZATION_FAILED", "Engine was disposed during initialization.");
      }

      this.worker = worker;
      return worker;
    } catch (err) {
      // Reset so the next call can retry
      this.initPromise = null;
      if (err instanceof OcrError) throw err;
      throw new OcrError(
        "OCR_INITIALIZATION_FAILED",
        "Failed to initialize the local OCR engine.",
        { cause: err }
      );
    }
  }

  /**
   * Recognize text in an image.
   *
   * @param input - Image as a File or Blob (JPEG, PNG, WebP).
   * @returns Normalized OCR result with text, confidence, and spatial data.
   *
   * @throws {OcrError} with appropriate code on failure.
   */
  async recognizeImage(input: Blob | File): Promise<OcrImageResult> {
    if (!input || input.size === 0) {
      throw new OcrError("OCR_IMAGE_DECODE_FAILED", "Empty image input.");
    }

    // Preprocess: upscale, greyscale, contrast
    let preprocessed: Awaited<ReturnType<typeof preprocessImage>>;
    try {
      preprocessed = await preprocessImage(input);
    } catch (err) {
      if (err instanceof OcrError) throw err;
      throw new OcrError("OCR_IMAGE_DECODE_FAILED", "Image preprocessing failed.", { cause: err });
    }

    // Get or init worker
    const worker = await this.getWorker();

    // Recognize with structured output (blocks → lines → words)
    let result: Tesseract.RecognizeResult;
    try {
      result = await worker.recognize(preprocessed.blob, {}, { blocks: true, text: true });
    } catch (err) {
      throw new OcrError(
        "OCR_RECOGNITION_FAILED",
        "OCR recognition failed.",
        { cause: err }
      );
    }

    return mapTesseractResult(
      result.data,
      preprocessed.originalWidth,
      preprocessed.originalHeight,
      preprocessed.processedWidth,
      preprocessed.processedHeight
    );
  }

  /**
   * Terminate the Tesseract worker and release resources.
   * Safe to call multiple times or during in-progress initialization.
   */
  async dispose(): Promise<void> {
    this.isDisposed = true;
    const worker = this.worker;
    const pendingInit = this.initPromise;
    this.worker = null;
    this.initPromise = null;

    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // Ignore termination errors
      }
    } else if (pendingInit) {
      try {
        const initializedWorker = await pendingInit;
        await initializedWorker.terminate();
      } catch {
        // Ignore errors if initialization aborted
      }
    }
  }
}
