import { describe, it, expect, vi } from "vitest";
import {
  computeScaleFactor,
  toGreyscale,
  enhanceContrast,
  detectDarkHeaderBand,
  normalizeDarkHeaderBand,
  flattenLightBackground,
  preprocessImage,
  TARGET_SCHEDULE_WIDTH,
  SMALL_IMAGE_WIDTH_THRESHOLD,
  MAX_DIMENSION,
  MAX_TOTAL_PIXELS,
} from "@/domain/ocr/image-preprocessor";
import { mapTesseractResult } from "@/domain/ocr/tesseract-engine";
import type Tesseract from "tesseract.js";

// ── computeScaleFactor ─────────────────────────────────────────────────

describe("computeScaleFactor", () => {
  it("A. Small image adaptive upscale: 669×276 targets ~1400–1600 px and respects pixel budget", () => {
    const scale = computeScaleFactor(669, 276);
    const scaledW = Math.round(669 * scale);
    const scaledH = Math.round(276 * scale);

    // Should target approximately 1400–1600 px (specifically ~1500 px)
    expect(scaledW).toBeGreaterThanOrEqual(1400);
    expect(scaledW).toBeLessThanOrEqual(1600);
    expect(scaledW).toBeCloseTo(TARGET_SCHEDULE_WIDTH, -2); // ~1500

    // Pixel budget check
    const totalPixels = scaledW * scaledH;
    expect(totalPixels).toBeLessThanOrEqual(MAX_TOTAL_PIXELS);
    expect(scaledW).toBeLessThanOrEqual(MAX_DIMENSION);
    expect(scaledH).toBeLessThanOrEqual(MAX_DIMENSION);
  });

  it("B. Already large image: does not aggressively upscale images with width >= 1400px or high resolution", () => {
    // 1600×900 is already wide enough
    expect(computeScaleFactor(1600, 900)).toBe(1.0);

    // 1920×1080 full HD
    expect(computeScaleFactor(1920, 1080)).toBe(1.0);

    // 1400 exactly at threshold
    expect(computeScaleFactor(SMALL_IMAGE_WIDTH_THRESHOLD, 800)).toBe(1.0);

    // High pixel resolution image (e.g. 1300 × 1200 = 1.56 MP)
    expect(computeScaleFactor(1300, 1200)).toBe(1.0);
  });

  it("caps upscale at 3× for very small images", () => {
    const scale = computeScaleFactor(100, 80);
    expect(scale).toBe(3.0);
    expect(100 * scale).toBe(300);
  });

  it("respects MAX_DIMENSION", () => {
    const scale = computeScaleFactor(400, 2000);
    const scaledH = 2000 * scale;
    expect(scaledH).toBeLessThanOrEqual(MAX_DIMENSION);
  });

  it("respects MAX_TOTAL_PIXELS", () => {
    const scale = computeScaleFactor(3000, 3000);
    const totalPixels = (3000 * scale) * (3000 * scale);
    expect(totalPixels).toBeLessThanOrEqual(MAX_TOTAL_PIXELS * 1.01);
  });

  it("never returns less than 1 (no downscaling)", () => {
    expect(computeScaleFactor(5000, 4000)).toBeGreaterThanOrEqual(1);
  });

  it("preserves aspect ratio (returns a single scale factor)", () => {
    const scale = computeScaleFactor(400, 600);
    const w = 400 * scale;
    const h = 600 * scale;
    const aspect = w / h;
    expect(aspect).toBeCloseTo(400 / 600, 5);
  });

  it("handles zero dimensions gracefully", () => {
    expect(computeScaleFactor(0, 0)).toBe(1);
    expect(computeScaleFactor(0, 100)).toBe(1);
    expect(computeScaleFactor(100, 0)).toBe(1);
  });

  it("handles negative dimensions gracefully", () => {
    expect(computeScaleFactor(-10, -20)).toBe(1);
  });
});

// ── toGreyscale ────────────────────────────────────────────────────────

describe("toGreyscale", () => {
  it("converts pure red to correct luma", () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    toGreyscale(data);
    expect(data[0]).toBeCloseTo(76, 0);
    expect(data[1]).toBeCloseTo(76, 0);
    expect(data[2]).toBeCloseTo(76, 0);
    expect(data[3]).toBe(255);
  });

  it("converts pure green to correct luma", () => {
    const data = new Uint8ClampedArray([0, 255, 0, 255]);
    toGreyscale(data);
    expect(data[0]).toBeCloseTo(150, 0);
    expect(data[1]).toBeCloseTo(150, 0);
    expect(data[2]).toBeCloseTo(150, 0);
  });

  it("converts pure blue to correct luma", () => {
    const data = new Uint8ClampedArray([0, 0, 255, 255]);
    toGreyscale(data);
    expect(data[0]).toBeCloseTo(29, 0);
    expect(data[1]).toBeCloseTo(29, 0);
    expect(data[2]).toBeCloseTo(29, 0);
  });

  it("preserves white and black", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    toGreyscale(data);
    expect(data[0]).toBe(255);
    expect(data[4]).toBe(0);
  });

  it("preserves alpha channel", () => {
    const data = new Uint8ClampedArray([100, 150, 200, 128]);
    toGreyscale(data);
    expect(data[3]).toBe(128);
  });
});

// ── Dark header polarity normalization ─────────────────────────────────

describe("Dark header polarity normalization", () => {
  const W = 100;
  const H = 200;

  function createSyntheticGreyscaleImage(width: number, height: number, defaultLuma: number = 255): Uint8ClampedArray {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = defaultLuma;
      data[i + 3] = 255;
    }
    return data;
  }

  it("C. Dark top header: dark horizontal header region is normalized/inverted", () => {
    // 100x200 image with white background (255)
    const data = createSyntheticGreyscaleImage(W, H, 255);

    // Create a dark header banner from y = 10 to y = 35 (height 26 px, starts at 5% of height)
    // 85% of pixels in the banner are dark (luma = 10), 15% are white text (luma = 255)
    for (let y = 10; y <= 35; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const isText = (x % 7 === 0);
        const luma = isText ? 255 : 10;
        data[idx] = data[idx + 1] = data[idx + 2] = luma;
      }
    }

    const band = detectDarkHeaderBand(data, W, H);
    expect(band).not.toBeNull();
    expect(band?.yStart).toBe(10);
    expect(band?.yEnd).toBe(35);
    expect(band?.height).toBe(26);
    expect(band?.meanLuminance).toBeLessThan(85);

    // Apply normalization/inversion
    const normalized = normalizeDarkHeaderBand(data, W, H);
    expect(normalized).not.toBeNull();

    // Verify dark background inside the banner became white (255 - 10 = 245)
    // and white text became dark (255 - 255 = 0)
    const bgPixelIdx = (20 * W + 2) * 4;
    expect(data[bgPixelIdx]).toBe(245);

    const textPixelIdx = (20 * W + 7) * 4;
    expect(data[textPixelIdx]).toBe(0);

    // Pixels below the header (e.g. y = 50) must remain untouched
    const bodyPixelIdx = (50 * W + 20) * 4;
    expect(data[bodyPixelIdx]).toBe(255);
  });

  it("D. Normal light header: is NOT inverted", () => {
    // White background with standard dark text header (luma 240 background, dark text)
    const data = createSyntheticGreyscaleImage(W, H, 245);

    // Header has dark text on light gray background (mean luma ~220)
    for (let y = 10; y <= 35; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        const isText = (x % 5 === 0);
        const luma = isText ? 20 : 230;
        data[idx] = data[idx + 1] = data[idx + 2] = luma;
      }
    }

    const band = detectDarkHeaderBand(data, W, H);
    expect(band).toBeNull();

    const normalized = normalizeDarkHeaderBand(data, W, H);
    expect(normalized).toBeNull();

    // Data should remain untouched
    const sampleIdx = (20 * W + 2) * 4;
    expect(data[sampleIdx]).toBe(230);
  });

  it("E. Narrow dark object near top: must NOT be mistaken for a table header", () => {
    const data = createSyntheticGreyscaleImage(W, H, 255);

    // A small dark logo/badge on the left from x = 0 to 15, y = 10 to 30
    for (let y = 10; y <= 30; y++) {
      for (let x = 0; x <= 15; x++) {
        const idx = (y * W + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = 10; // dark
      }
    }

    // Narrow dark object covers only 16% width, far below the 70% requirement
    const band = detectDarkHeaderBand(data, W, H);
    expect(band).toBeNull();

    const normalized = normalizeDarkHeaderBand(data, W, H);
    expect(normalized).toBeNull();
  });

  it("safeguards: rejects dark bands starting too low in the image", () => {
    const data = createSyntheticGreyscaleImage(W, H, 255);

    // Dark band located at y = 80 to 110 (starts at 40% of height, too low for header)
    for (let y = 80; y <= 110; y++) {
      for (let x = 0; x < W; x++) {
        const idx = (y * W + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = 10;
      }
    }

    const band = detectDarkHeaderBand(data, W, H);
    expect(band).toBeNull();
  });
});

// ── flattenLightBackground ─────────────────────────────────────────────

describe("flattenLightBackground", () => {
  it("flattens alternating light-gray table backgrounds (>185) to pure white (255)", () => {
    // 4 pixels: dark text (20), medium text (150), light-gray row (210), white (255)
    const data = new Uint8ClampedArray([
      20, 20, 20, 255,
      150, 150, 150, 255,
      210, 210, 210, 255,
      255, 255, 255, 255,
    ]);

    flattenLightBackground(data);

    // Dark text preserved
    expect(data[0]).toBe(20);
    expect(data[4]).toBe(150);

    // Light-gray row flattened to pure white
    expect(data[8]).toBe(255);
    expect(data[9]).toBe(255);
    expect(data[10]).toBe(255);

    // Pure white preserved
    expect(data[12]).toBe(255);
  });
});

// ── enhanceContrast ────────────────────────────────────────────────────

describe("enhanceContrast", () => {
  it("stretches a narrow range to full 0–255", () => {
    const data = new Uint8ClampedArray(400);
    for (let i = 0; i < data.length; i += 4) {
      const v = i < data.length / 2 ? 100 : 200;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    enhanceContrast(data);

    expect(data[0]).toBeLessThanOrEqual(10);
    expect(data[data.length - 4]).toBeGreaterThanOrEqual(245);
  });

  it("does not crash on uniform data", () => {
    const data = new Uint8ClampedArray(40);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 128;
      data[i + 3] = 255;
    }
    enhanceContrast(data);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(255);
    }
  });
});

// ── Safari / WebKit HTMLCanvas fallback & Coordinate contract ───────────

describe("HTMLCanvas Fallback & Coordinate Contract", () => {
  it("F. Safari/WebKit HTMLCanvas fallback works when OffscreenCanvas is unavailable", async () => {
    // Mock Blob and document.createElement('canvas') environment
    const origOffscreen = globalThis.OffscreenCanvas;
    const origDocument = (globalThis as any).document;
    try {
      // Temporarily remove OffscreenCanvas to simulate Safari fallback
      (globalThis as any).OffscreenCanvas = undefined;

      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue({
          drawImage: vi.fn(),
          getImageData: vi.fn().mockReturnValue({
            data: new Uint8ClampedArray(100 * 50 * 4).fill(255),
          }),
          putImageData: vi.fn(),
        }),
        toBlob: vi.fn((cb: (b: Blob) => void) => {
          cb(new Blob(["mock-png"], { type: "image/png" }));
        }),
      };

      (globalThis as any).document = {
        createElement: vi.fn((tag: string) => {
          if (tag === "canvas") return mockCanvas;
          return null;
        }),
      };

      // Mock createImageBitmap
      const mockBmp = { width: 669, height: 276, close: vi.fn() };
      globalThis.createImageBitmap = vi.fn().mockResolvedValue(mockBmp) as any;

      const inputBlob = new Blob(["fake-image"], { type: "image/png" });
      const result = await preprocessImage(inputBlob);

      expect(result.originalWidth).toBe(669);
      expect(result.originalHeight).toBe(276);
      expect(result.processedWidth).toBeCloseTo(1500, -2);
      expect(mockCanvas.getContext).toHaveBeenCalledWith("2d");
      expect(mockCanvas.toBlob).toHaveBeenCalled();
    } finally {
      globalThis.OffscreenCanvas = origOffscreen;
      (globalThis as any).document = origDocument;
      vi.restoreAllMocks();
    }
  });

  it("G. Bounding-box coordinate contract remains unchanged: maps back to original dimensions", () => {
    // Original uploaded image: 669 × 276
    // Processed upscaled image: 1500 × 619
    const origW = 669;
    const origH = 276;
    const procW = 1500;
    const procH = 619;

    // A word in the upscaled image at x0=1200, y0=280, x1=1440, y1=310 (Row 3 "مختبر")
    const mockWord: Tesseract.Word = {
      text: "مختبر",
      confidence: 91,
      bbox: { x0: 1200, y0: 280, x1: 1440, y1: 310 },
      font_name: "Arial",
      symbols: [],
      choices: [],
    };

    const mockLine: Tesseract.Line = {
      text: "مختبر قواعد البيانات",
      confidence: 91,
      bbox: { x0: 1000, y0: 280, x1: 1440, y1: 310 },
      baseline: { x0: 1000, y0: 310, x1: 1440, y1: 310 },
      rowAttributes: { ascenders: 0, descenders: 0, rowHeight: 30 },
      words: [mockWord],
    };

    const mockPage: Tesseract.Page = {
      blocks: [
        {
          paragraphs: [
            {
              lines: [mockLine],
              text: "مختبر قواعد البيانات\n",
              confidence: 91,
              bbox: mockLine.bbox,
              is_ltr: false,
            },
          ],
          text: "مختبر قواعد البيانات\n",
          confidence: 91,
          bbox: mockLine.bbox,
          blocktype: "FLOWING_TEXT",
          page: null as unknown as Tesseract.Page,
        },
      ],
      confidence: 91,
      text: "مختبر قواعد البيانات\n",
      oem: "LSTM_ONLY",
      osd: "",
      psm: "SINGLE_COLUMN",
      version: "7.0.0",
      hocr: null, tsv: null, box: null, unlv: null, sd: null,
      imageColor: null, imageGrey: null, imageBinary: null,
      rotateRadians: null, pdf: null, debug: null,
    };

    const mapped = mapTesseractResult(mockPage, origW, origH, procW, procH);

    // Check scale factors: scaleX = 669 / 1500 = 0.446, scaleY = 276 / 619 = 0.44588
    const expectedWordX0 = Math.round(1200 * (origW / procW)); // ~535
    const expectedWordY0 = Math.round(280 * (origH / procH));  // ~125
    const expectedWordX1 = Math.round(1440 * (origW / procW)); // ~642
    const expectedWordY1 = Math.round(310 * (origH / procH));  // ~138

    expect(mapped.width).toBe(origW);
    expect(mapped.height).toBe(origH);
    expect(mapped.words[0].bbox.x0).toBe(expectedWordX0);
    expect(mapped.words[0].bbox.y0).toBe(expectedWordY0);
    expect(mapped.words[0].bbox.x1).toBe(expectedWordX1);
    expect(mapped.words[0].bbox.y1).toBe(expectedWordY1);

    // Original coordinates must be within original bounds
    expect(mapped.words[0].bbox.x1).toBeLessThanOrEqual(origW);
    expect(mapped.words[0].bbox.y1).toBeLessThanOrEqual(origH);
  });
});
