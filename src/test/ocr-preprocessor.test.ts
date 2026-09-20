import { describe, it, expect } from "vitest";
import {
  computeScaleFactor,
  toGreyscale,
  enhanceContrast,
  MIN_USEFUL_WIDTH,
  MAX_DIMENSION,
  MAX_TOTAL_PIXELS,
} from "@/domain/ocr/image-preprocessor";

// ── computeScaleFactor ─────────────────────────────────────────────────

describe("computeScaleFactor", () => {
  it("does not upscale images already wide enough", () => {
    const scale = computeScaleFactor(1200, 800);
    expect(scale).toBe(1);
  });

  it("does not upscale images at exactly MIN_USEFUL_WIDTH", () => {
    const scale = computeScaleFactor(MIN_USEFUL_WIDTH, 600);
    expect(scale).toBe(1);
  });

  it("upscales small images toward MIN_USEFUL_WIDTH", () => {
    const scale = computeScaleFactor(400, 300);
    // target = 800 / 400 = 2
    expect(scale).toBe(2);
  });

  it("caps upscale at 3× for very small images", () => {
    const scale = computeScaleFactor(100, 80);
    // target = 800 / 100 = 8, but capped at 3
    expect(scale).toBeLessThanOrEqual(3);
    expect(scale).toBeGreaterThanOrEqual(1);
  });

  it("respects MAX_DIMENSION", () => {
    const scale = computeScaleFactor(400, 2000);
    const scaledH = 2000 * scale;
    expect(scaledH).toBeLessThanOrEqual(MAX_DIMENSION);
  });

  it("respects MAX_TOTAL_PIXELS", () => {
    const scale = computeScaleFactor(3000, 3000);
    const totalPixels = (3000 * scale) * (3000 * scale);
    expect(totalPixels).toBeLessThanOrEqual(MAX_TOTAL_PIXELS * 1.01); // small rounding tolerance
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

  it("upscales 500px width to approximately 800px", () => {
    const scale = computeScaleFactor(500, 400);
    const scaledW = 500 * scale;
    // Should be around 800 (scale = 1.6)
    expect(scaledW).toBeGreaterThanOrEqual(MIN_USEFUL_WIDTH - 1);
    expect(scale).toBeCloseTo(1.6, 1);
  });
});

// ── toGreyscale ────────────────────────────────────────────────────────

describe("toGreyscale", () => {
  it("converts pure red to correct luma", () => {
    // Pure red (255, 0, 0) → luma ≈ 76.245
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    toGreyscale(data);
    expect(data[0]).toBeCloseTo(76, 0);
    expect(data[1]).toBeCloseTo(76, 0);
    expect(data[2]).toBeCloseTo(76, 0);
    expect(data[3]).toBe(255); // alpha preserved
  });

  it("converts pure green to correct luma", () => {
    // Pure green (0, 255, 0) → luma ≈ 149.685
    const data = new Uint8ClampedArray([0, 255, 0, 255]);
    toGreyscale(data);
    expect(data[0]).toBeCloseTo(150, 0);
    expect(data[1]).toBeCloseTo(150, 0);
    expect(data[2]).toBeCloseTo(150, 0);
  });

  it("converts pure blue to correct luma", () => {
    // Pure blue (0, 0, 255) → luma ≈ 29.07
    const data = new Uint8ClampedArray([0, 0, 255, 255]);
    toGreyscale(data);
    expect(data[0]).toBeCloseTo(29, 0);
    expect(data[1]).toBeCloseTo(29, 0);
    expect(data[2]).toBeCloseTo(29, 0);
  });

  it("preserves white", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255]);
    toGreyscale(data);
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(255);
    expect(data[2]).toBe(255);
  });

  it("preserves black", () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255]);
    toGreyscale(data);
    expect(data[0]).toBe(0);
    expect(data[1]).toBe(0);
    expect(data[2]).toBe(0);
  });

  it("preserves alpha channel", () => {
    const data = new Uint8ClampedArray([100, 150, 200, 128]);
    toGreyscale(data);
    expect(data[3]).toBe(128);
  });

  it("handles multiple pixels", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,    // red
      0, 255, 0, 255,    // green
      0, 0, 255, 255,    // blue
    ]);
    toGreyscale(data);
    // All R, G, B should be equal within each pixel
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
    expect(data[4]).toBe(data[5]);
    expect(data[5]).toBe(data[6]);
    expect(data[8]).toBe(data[9]);
    expect(data[9]).toBe(data[10]);
  });
});

// ── enhanceContrast ────────────────────────────────────────────────────

describe("enhanceContrast", () => {
  it("stretches a narrow range to full 0–255", () => {
    // All pixels at intensity 100 or 200
    // 50% each → p1≈100, p99≈200 → stretch 100..200 to 0..255
    const data = new Uint8ClampedArray(400); // 100 pixels
    for (let i = 0; i < data.length; i += 4) {
      const v = i < data.length / 2 ? 100 : 200;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    enhanceContrast(data);

    // Dark pixels should be near 0, light near 255
    expect(data[0]).toBeLessThanOrEqual(10);
    expect(data[data.length - 4]).toBeGreaterThanOrEqual(245);
  });

  it("does not crash on uniform data", () => {
    // All same intensity — high == low, should be no-op
    const data = new Uint8ClampedArray(40); // 10 pixels
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 128;
      data[i + 3] = 255;
    }
    enhanceContrast(data);
    // Should not crash; values should remain at 128 or close
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBeGreaterThanOrEqual(0);
      expect(data[i]).toBeLessThanOrEqual(255);
    }
  });

  it("preserves already full-range data approximately", () => {
    // Pixels spanning 0–255 — stretch should barely change them
    const data = new Uint8ClampedArray(1024); // 256 pixels
    for (let i = 0; i < data.length; i += 4) {
      const v = (i / 4) % 256;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    const originalMid = data[512]; // pixel 128 → intensity 128
    enhanceContrast(data);
    // Mid-range values should be approximately unchanged
    expect(Math.abs(data[512] - originalMid)).toBeLessThan(20);
  });

  it("does not modify alpha channel", () => {
    const data = new Uint8ClampedArray([100, 100, 100, 77, 200, 200, 200, 33]);
    enhanceContrast(data);
    expect(data[3]).toBe(77);
    expect(data[7]).toBe(33);
  });
});
