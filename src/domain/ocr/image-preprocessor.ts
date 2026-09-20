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

/** Minimum width threshold (px) below which an image is considered a small screenshot in need of upscale. */
export const SMALL_IMAGE_WIDTH_THRESHOLD = 1400;

/** Target width (px) for small schedule screenshots to ensure legible Arabic glyph height (~25–35 px). */
export const TARGET_SCHEDULE_WIDTH = 1500;

/** Backward-compatible alias for previous constant. */
export const MIN_USEFUL_WIDTH = TARGET_SCHEDULE_WIDTH;

/** No single dimension should exceed this to avoid GPU texture limits. */
export const MAX_DIMENSION = 4096;

/** Total pixel budget — ~16.7 MP.  iOS Safari is safe up to ~16.7 MP. */
export const MAX_TOTAL_PIXELS = MAX_DIMENSION * MAX_DIMENSION;

/** Threshold for high-resolution images (~1.5 MP) that do not require upscaling. */
export const LARGE_IMAGE_PIXEL_THRESHOLD = 1_500_000;

/** Never downscale — preserve everything the user gave us. */
const MIN_SCALE = 1.0;

/** Diminishing returns and memory cost above 3×. */
const MAX_SCALE = 3.0;

// ── Pure utility functions (testable without Canvas) ───────────────────

/**
 * Compute the deterministic scale factor for an image.
 *
 * Rules:
 *   1. If width ≥ SMALL_IMAGE_WIDTH_THRESHOLD (1400px) or total pixels ≥ LARGE_IMAGE_PIXEL_THRESHOLD (1.5 MP),
 *      keep scale = 1.0 (already high resolution, avoid aggressive or unnecessary upscale).
 *   2. For small screenshots (e.g. 669×276), target TARGET_SCHEDULE_WIDTH (1500px), clamped to [1.0, 3.0].
 *   3. Ensure neither dimension exceeds MAX_DIMENSION (4096).
 *   4. Ensure total pixels ≤ MAX_TOTAL_PIXELS (16.7 MP).
 *
 * @returns scale factor ≥ 1
 */
export function computeScaleFactor(width: number, height: number): number {
  if (width <= 0 || height <= 0) return MIN_SCALE;

  // Rule 1 — If already high-resolution, do not upscale
  if (width >= SMALL_IMAGE_WIDTH_THRESHOLD || width * height >= LARGE_IMAGE_PIXEL_THRESHOLD) {
    return MIN_SCALE;
  }

  // Rule 2 — Target 1400–1600 px (specifically 1500 px) for small schedule screenshots
  let scale = Math.min(TARGET_SCHEDULE_WIDTH / width, MAX_SCALE);

  // Rule 3 — clamp by max dimension
  const maxDimScale = Math.min(
    MAX_DIMENSION / width,
    MAX_DIMENSION / height
  );
  scale = Math.min(scale, maxDimScale);

  // Rule 4 — clamp by pixel budget
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

// ── Dark header polarity normalization & background cleaning ───────────

export interface DarkHeaderBand {
  yStart: number;
  yEnd: number;
  height: number;
  meanLuminance: number;
  darkCoverage: number;
}

/**
 * Detect a dark horizontal header band near the top of the image.
 *
 * Requirements (conservative, evidence-based):
 * 1. Inspect only the upper table/header region (y <= 35% of height, max 300px).
 * 2. Require low mean luminance (< 85 out of 255) and high dark coverage (> 60% of pixels luma < 75).
 * 3. Horizontal dark span must cover at least 70% of image width (rules out narrow icons/buttons).
 * 4. Band height must be between min(12px, 4% of height) and 25% of height.
 * 5. Band must start near top (yStart <= 20% of height).
 */
export function detectDarkHeaderBand(
  data: Uint8ClampedArray,
  width: number,
  height: number
): DarkHeaderBand | null {
  if (width <= 0 || height <= 0 || data.length < width * height * 4) {
    return null;
  }

  const maxScanY = Math.min(Math.round(height * 0.35), 300);
  let darkStart = -1;
  let darkEnd = -1;
  let totalLumaInBand = 0;
  let totalDarkPixelsInBand = 0;
  let totalRowsInBand = 0;

  for (let y = 0; y < maxScanY; y++) {
    let rowLumaSum = 0;
    let rowDarkCount = 0;
    let minDarkX = width;
    let maxDarkX = -1;

    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const luma = data[idx]; // data is greyscale
      rowLumaSum += luma;
      if (luma < 75) {
        rowDarkCount++;
        if (x < minDarkX) minDarkX = x;
        if (x > maxDarkX) maxDarkX = x;
      }
    }

    const meanLuma = rowLumaSum / width;
    const darkRatio = rowDarkCount / width;
    const horizontalSpan = maxDarkX >= minDarkX ? (maxDarkX - minDarkX + 1) / width : 0;

    // A row qualifies as a dark table header row only if it has low mean luminance,
    // high dark coverage, and wide horizontal span across the page.
    const isDarkRow = meanLuma < 85 && darkRatio > 0.60 && horizontalSpan >= 0.70;

    if (isDarkRow) {
      if (darkStart === -1) darkStart = y;
      darkEnd = y;
      totalLumaInBand += meanLuma;
      totalDarkPixelsInBand += rowDarkCount;
      totalRowsInBand++;
    } else if (darkStart !== -1) {
      // Tolerate a small 1-3 row dip for internal text or thin horizontal divider within the header
      if (y - darkEnd > 3) {
        break;
      }
    }
  }

  if (darkStart === -1 || totalRowsInBand === 0) {
    return null;
  }

  const bandHeight = darkEnd - darkStart + 1;
  const minHeight = Math.max(12, Math.round(height * 0.04));
  const maxHeight = Math.round(height * 0.25);
  const maxStartOffset = Math.round(height * 0.20);

  // Conservative safeguards
  if (
    bandHeight < minHeight ||
    bandHeight > maxHeight ||
    darkStart > maxStartOffset
  ) {
    return null;
  }

  const meanLuminance = totalLumaInBand / totalRowsInBand;
  const darkCoverage = totalDarkPixelsInBand / (totalRowsInBand * width);

  return {
    yStart: darkStart,
    yEnd: darkEnd,
    height: bandHeight,
    meanLuminance,
    darkCoverage,
  };
}

/**
 * Invert ONLY the pixels of a detected dark header band.
 * Returns the detected band if inverted, or null if no band qualified.
 */
export function normalizeDarkHeaderBand(
  data: Uint8ClampedArray,
  width: number,
  height: number
): DarkHeaderBand | null {
  const band = detectDarkHeaderBand(data, width, height);
  if (!band) return null;

  for (let y = band.yStart; y <= band.yEnd; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = 255 - data[idx];
      data[idx + 1] = 255 - data[idx + 1];
      data[idx + 2] = 255 - data[idx + 2];
    }
  }

  return band;
}

/**
 * Flatten light background (e.g. alternating light-gray table row backgrounds) to pure white.
 * TTU schedules use alternating #e0e0e0 (luma ~220) row stripes.
 * Mapping any pixel with luma > 185 to 255 produces a clean uniform background,
 * preventing Tesseract's binarizer from dropping alternating rows.
 */
export function flattenLightBackground(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 185) {
      data[i] = data[i + 1] = data[i + 2] = 255;
    }
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

  // Create canvas (prefers OffscreenCanvas, falls back to DOM canvas in WebKit/Safari)
  let blob: Blob;

  if (typeof OffscreenCanvas !== "undefined" && typeof (OffscreenCanvas.prototype as any).convertToBlob === "function") {
    const canvas = new OffscreenCanvas(targetW, targetH);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new OcrError("OCR_IMAGE_DECODE_FAILED", "Failed to create canvas context.");
    }

    ctx.drawImage(source, 0, 0, targetW, targetH);

    if ("close" in source && typeof (source as any).close === "function") {
      (source as any).close();
    }

    const imageData = ctx.getImageData(0, 0, targetW, targetH);
    toGreyscale(imageData.data);
    normalizeDarkHeaderBand(imageData.data, targetW, targetH);
    flattenLightBackground(imageData.data);
    enhanceContrast(imageData.data);
    ctx.putImageData(imageData, 0, 0);

    blob = await canvas.convertToBlob({ type: "image/png" });
  } else if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new OcrError("OCR_IMAGE_DECODE_FAILED", "Failed to create canvas context.");
    }

    ctx.drawImage(source, 0, 0, targetW, targetH);

    if ("close" in source && typeof (source as any).close === "function") {
      (source as any).close();
    }

    const imageData = ctx.getImageData(0, 0, targetW, targetH);
    toGreyscale(imageData.data);
    normalizeDarkHeaderBand(imageData.data, targetW, targetH);
    flattenLightBackground(imageData.data);
    enhanceContrast(imageData.data);
    ctx.putImageData(imageData, 0, 0);

    blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob failed"));
      }, "image/png");
    });
  } else {
    throw new OcrError("OCR_IMAGE_DECODE_FAILED", "No canvas implementation available in this environment.");
  }

  return {
    blob,
    originalWidth: origW,
    originalHeight: origH,
    processedWidth: targetW,
    processedHeight: targetH,
  };
}
