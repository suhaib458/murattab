/**
 * Browser-local image preprocessing pipeline for OCR.
 *
 * Takes an image (File / Blob) and produces an OCR-ready greyscale PNG with
 * conservative contrast enhancement and bounded upscaling.
 *
 * Design constraints:
 *   - Original uploaded image is never mutated.
 *   - All work happens on an in-memory canvas copy.
 *   - No network requests.
 *   - Memory-safe on mobile (bounded canvas dimensions and pixel budget).
 */

import { OcrError, type PreprocessedImage } from "./types";

// ── Upscaling policy constants ─────────────────────────────────────────
//
// Tesseract accuracy drops noticeably below ~800 px width for table-like
// text, so we upscale small screenshots.  We cap the output to avoid
// out-of-memory on low-end phones (especially iOS Safari, which can abort
// pages with large canvases).

/** Minimum width (px) at which Tesseract produces reliable results. */
export const MIN_USEFUL_WIDTH = 800;

/** No single dimension should exceed this to avoid GPU texture limits. */
export const MAX_DIMENSION = 4096;

/** Total pixel budget — ~16.7 MP.  iOS Safari is safe up to ~16.7 MP. */
export const MAX_TOTAL_PIXELS = MAX_DIMENSION * MAX_DIMENSION;

/** Never downscale — preserve everything the user gave us. */
const MIN_SCALE = 1.0;

/** Diminishing returns and memory cost above 3×. */
const MAX_SCALE = 3.0;

// ── Pure utility functions (testable without Canvas) ───────────────────

/**
 * Compute the deterministic scale factor for an image.
 *
 * Rules:
 *   1. If width ≥ MIN_USEFUL_WIDTH, keep scale = 1 (no upscale).
 *   2. Otherwise, target = MIN_USEFUL_WIDTH / width, clamped to [1, 3].
 *   3. Ensure neither dimension exceeds MAX_DIMENSION.
 *   4. Ensure total pixels ≤ MAX_TOTAL_PIXELS.
 *
 * @returns scale factor ≥ 1
 */
export function computeScaleFactor(width: number, height: number): number {
  if (width <= 0 || height <= 0) return MIN_SCALE;

  // Step 1 — target scale
  let scale = width >= MIN_USEFUL_WIDTH
    ? MIN_SCALE
    : Math.min(MIN_USEFUL_WIDTH / width, MAX_SCALE);

  // Step 2 — clamp by max dimension
  const maxDimScale = Math.min(
    MAX_DIMENSION / width,
    MAX_DIMENSION / height
  );
  scale = Math.min(scale, maxDimScale);

  // Step 3 — clamp by pixel budget
  const pixelScale = Math.sqrt(MAX_TOTAL_PIXELS / (width * height));
  scale = Math.min(scale, pixelScale);

  return Math.max(scale, MIN_SCALE);
}

/**
 * Convert RGBA pixel data to greyscale in-place using ITU-R BT.601 luma.
 *
 * formula: Y = 0.299 R + 0.587 G + 0.114 B
 *
 * Sets R = G = B = Y, preserves alpha.
 */
export function toGreyscale(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = data[i + 1] = data[i + 2] = y;
  }
}

/**
 * Apply conservative linear contrast stretch.
 *
 * Finds the 1st and 99th percentile intensity values, then linearly maps
 * [low, high] → [0, 255].  This avoids aggressive binarization that
 * destroys thin Arabic strokes.
 */
export function enhanceContrast(data: Uint8ClampedArray): void {
  // Build histogram (assumes greyscale — R channel only)
  const histogram = new Uint32Array(256);
  const pixelCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]]++;
  }

  // Find 1st / 99th percentile
  const lowTarget = Math.floor(pixelCount * 0.01);
  const highTarget = Math.floor(pixelCount * 0.99);

  let low = 0;
  let cumulative = 0;
  for (; low < 256; low++) {
    cumulative += histogram[low];
    if (cumulative >= lowTarget) break;
  }

  let high = 255;
  cumulative = 0;
  for (; high >= 0; high--) {
    cumulative += histogram[high];
    if (cumulative >= (pixelCount - highTarget)) break;
  }

  // Avoid division by zero / no-op
  if (high <= low) return;

  const range = high - low;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i];
    const stretched = Math.round(((Math.min(Math.max(v, low), high) - low) / range) * 255);
    data[i] = data[i + 1] = data[i + 2] = stretched;
  }
}

// ── Image decoding ─────────────────────────────────────────────────────

/**
 * Decode an image Blob into an ImageBitmap or HTMLImageElement.
 *
 * Uses createImageBitmap when available (Chrome, Firefox, modern Safari),
 * falls back to HTMLImageElement + ObjectURL for older iOS Safari or
 * environments where createImageBitmap is unavailable.
 */
async function decodeImage(
  blob: Blob
): Promise<{ source: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  // Prefer createImageBitmap — faster, works off main thread
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(blob);
      return { source: bmp, width: bmp.width, height: bmp.height };
    } catch {
      // Fall through to HTMLImageElement fallback
    }
  }

  // Fallback: HTMLImageElement + ObjectURL
  if (typeof document !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = document.createElement("img");
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Image decode failed"));
        el.src = url;
      });
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  throw new OcrError(
    "OCR_IMAGE_DECODE_FAILED",
    "No image decoding API available in this environment."
  );
}

// ── Public preprocessing pipeline ──────────────────────────────────────

/**
 * Preprocess an image for OCR.
 *
 * Pipeline:
 *   1. Decode image
 *   2. Compute bounded scale factor
 *   3. Draw to off-screen canvas at target size
 *   4. Convert to greyscale
 *   5. Apply conservative contrast enhancement
 *   6. Return as PNG Blob + original dimensions
 *
 * @throws {OcrError} with code OCR_IMAGE_DECODE_FAILED or OCR_IMAGE_TOO_LARGE
 */
export async function preprocessImage(input: Blob): Promise<PreprocessedImage> {
  if (input.size === 0) {
    throw new OcrError("OCR_IMAGE_DECODE_FAILED", "Empty image input.");
  }

  // Validate supported image types
  const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/bmp"];
  if (input.type && !supportedTypes.includes(input.type)) {
    throw new OcrError("OCR_UNSUPPORTED_IMAGE", `Unsupported image type: ${input.type}`);
  }

  let decoded: Awaited<ReturnType<typeof decodeImage>>;
  try {
    decoded = await decodeImage(input);
  } catch (err) {
    if (err instanceof OcrError) throw err;
    throw new OcrError("OCR_IMAGE_DECODE_FAILED", "Failed to decode image.", { cause: err });
  }

  const { source, width: origW, height: origH } = decoded;

  if (origW <= 0 || origH <= 0) {
    throw new OcrError("OCR_IMAGE_DECODE_FAILED", "Image has zero dimensions.");
  }

  // Check if the source image is already too large (even at scale 1)
  if (origW * origH > MAX_TOTAL_PIXELS * 1.5) {
    throw new OcrError(
      "OCR_IMAGE_TOO_LARGE",
      `Image is too large for OCR processing (${origW}×${origH}).`
    );
  }

  const scale = computeScaleFactor(origW, origH);
  const targetW = Math.round(origW * scale);
  const targetH = Math.round(origH * scale);

  // Create off-screen canvas
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new OcrError("OCR_IMAGE_DECODE_FAILED", "Failed to create canvas context.");
  }

  // Draw image at target size
  ctx.drawImage(source, 0, 0, targetW, targetH);

  // Release ImageBitmap memory if applicable
  if ("close" in source && typeof source.close === "function") {
    source.close();
  }

  // Get pixel data and apply preprocessing
  const imageData = ctx.getImageData(0, 0, targetW, targetH);
  toGreyscale(imageData.data);
  enhanceContrast(imageData.data);
  ctx.putImageData(imageData, 0, 0);

  // Export as PNG Blob
  const blob = await canvas.convertToBlob({ type: "image/png" });

  return {
    blob,
    originalWidth: origW,
    originalHeight: origH,
    processedWidth: targetW,
    processedHeight: targetH,
  };
}
