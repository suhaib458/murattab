import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Tesseract from "tesseract.js";
import { OcrError } from "@/domain/ocr/types";
import { mapTesseractResult } from "@/domain/ocr/tesseract-engine";

// ── Synthetic fixture: TTU-style schedule row ──────────────────────────
//
// Simulates Tesseract output for a simplified Arabic/English TTU row:
//   تصور البيانات
//   ح ث خ
//   10:00 - 11:00
//   207 م
//   ICT - 4
//
// NO private student data. For testing only.

function createMockBbox(x0: number, y0: number, x1: number, y1: number): Tesseract.Bbox {
  return { x0, y0, x1, y1 };
}

function createMockWord(text: string, confidence: number, x0: number, y0: number, x1: number, y1: number): Tesseract.Word {
  return {
    text,
    confidence,
    bbox: createMockBbox(x0, y0, x1, y1),
    font_name: "Arial",
    symbols: [],
    choices: [],
  };
}

function createMockLine(text: string, confidence: number, words: Tesseract.Word[]): Tesseract.Line {
  const x0 = Math.min(...words.map((w) => w.bbox.x0));
  const y0 = Math.min(...words.map((w) => w.bbox.y0));
  const x1 = Math.max(...words.map((w) => w.bbox.x1));
  const y1 = Math.max(...words.map((w) => w.bbox.y1));
  return {
    text,
    confidence,
    bbox: createMockBbox(x0, y0, x1, y1),
    baseline: { x0, y0: y1, x1, y1: y1 },
    rowAttributes: { ascenders: 0, descenders: 0, rowHeight: y1 - y0 },
    words,
  };
}

function createSyntheticTtuPage(): Tesseract.Page {
  const line1Words = [
    createMockWord("تصور", 92, 200, 10, 280, 30),
    createMockWord("البيانات", 88, 100, 10, 195, 30),
  ];
  const line2Words = [
    createMockWord("ح", 95, 250, 40, 265, 55),
    createMockWord("ث", 93, 220, 40, 235, 55),
    createMockWord("خ", 90, 190, 40, 205, 55),
  ];
  const line3Words = [
    createMockWord("10:00", 96, 100, 70, 160, 85),
    createMockWord("-", 99, 165, 70, 175, 85),
    createMockWord("11:00", 97, 180, 70, 240, 85),
  ];
  const line4Words = [
    createMockWord("207", 94, 100, 100, 145, 115),
    createMockWord("م", 85, 150, 100, 165, 115),
  ];
  const line5Words = [
    createMockWord("ICT", 98, 100, 130, 145, 145),
    createMockWord("-", 99, 150, 130, 160, 145),
    createMockWord("4", 97, 165, 130, 175, 145),
  ];

  const line1 = createMockLine("تصور البيانات", 90, line1Words);
  const line2 = createMockLine("ح ث خ", 93, line2Words);
  const line3 = createMockLine("10:00 - 11:00", 97, line3Words);
  const line4 = createMockLine("207 م", 89, line4Words);
  const line5 = createMockLine("ICT - 4", 98, line5Words);

  const paragraph: Tesseract.Paragraph = {
    lines: [line1, line2, line3, line4, line5],
    text: "تصور البيانات\nح ث خ\n10:00 - 11:00\n207 م\nICT - 4\n",
    confidence: 93,
    bbox: createMockBbox(100, 10, 280, 145),
    is_ltr: false,
  };

  const block: Tesseract.Block = {
    paragraphs: [paragraph],
    text: paragraph.text,
    confidence: 93,
    bbox: paragraph.bbox,
    blocktype: "FLOWING_TEXT",
    page: null as unknown as Tesseract.Page,
  };

  return {
    blocks: [block],
    confidence: 93,
    text: paragraph.text,
    oem: "LSTM_ONLY",
    osd: "",
    psm: "AUTO",
    version: "7.0.0",
    hocr: null,
    tsv: null,
    box: null,
    unlv: null,
    sd: null,
    imageColor: null,
    imageGrey: null,
    imageBinary: null,
    rotateRadians: null,
    pdf: null,
    debug: null,
  };
}

// ── mapTesseractResult tests ───────────────────────────────────────────

describe("mapTesseractResult", () => {
  const page = createSyntheticTtuPage();
  const result = mapTesseractResult(page, 800, 600);

  it("preserves Arabic text in lines", () => {
    expect(result.lines[0].text).toBe("تصور البيانات");
  });

  it("preserves Arabic text in words", () => {
    const arabicWords = result.words.filter((w) => /[\u0600-\u06FF]/.test(w.text));
    expect(arabicWords.length).toBeGreaterThanOrEqual(2);
    expect(arabicWords.map((w) => w.text)).toContain("تصور");
    expect(arabicWords.map((w) => w.text)).toContain("البيانات");
  });

  it("preserves English text in words", () => {
    const englishWords = result.words.filter((w) => /[A-Z]/.test(w.text));
    expect(englishWords.map((w) => w.text)).toContain("ICT");
  });

  it("preserves day codes", () => {
    expect(result.lines[1].text).toBe("ح ث خ");
  });

  it("preserves time text", () => {
    expect(result.lines[2].text).toBe("10:00 - 11:00");
  });

  it("normalizes confidence from 0–100 to 0–1", () => {
    // Page confidence was 93 → 0.93
    expect(result.confidence).toBeCloseTo(0.93, 2);
    // First word "تصور" had confidence 92 → 0.92
    const firstWord = result.words.find((w) => w.text === "تصور");
    expect(firstWord?.confidence).toBeCloseTo(0.92, 2);
  });

  it("maps bounding box coordinates correctly", () => {
    const firstWord = result.words.find((w) => w.text === "تصور");
    expect(firstWord?.bbox).toEqual({ x0: 200, y0: 10, x1: 280, y1: 30 });
  });

  it("stores original image dimensions", () => {
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("has correct line count", () => {
    expect(result.lines).toHaveLength(5);
  });

  it("has correct total word count (excluding empty)", () => {
    // 2 + 3 + 3 + 2 + 3 = 13 words (the "-" words are kept since they have text)
    expect(result.words.length).toBe(13);
  });

  it("filters empty words", () => {
    // All words should have non-empty trimmed text
    for (const word of result.words) {
      expect(word.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("mapTesseractResult — edge cases", () => {
  it("handles null blocks gracefully", () => {
    const page: Tesseract.Page = {
      blocks: null,
      confidence: 0,
      text: "",
      oem: "LSTM_ONLY",
      osd: "",
      psm: "AUTO",
      version: "7.0.0",
      hocr: null, tsv: null, box: null, unlv: null, sd: null,
      imageColor: null, imageGrey: null, imageBinary: null,
      rotateRadians: null, pdf: null, debug: null,
    };
    const result = mapTesseractResult(page, 100, 100);
    expect(result.lines).toHaveLength(0);
    expect(result.words).toHaveLength(0);
    expect(result.text).toBe("");
  });

  it("handles empty blocks array", () => {
    const page: Tesseract.Page = {
      blocks: [],
      confidence: 50,
      text: "",
      oem: "LSTM_ONLY",
      osd: "",
      psm: "AUTO",
      version: "7.0.0",
      hocr: null, tsv: null, box: null, unlv: null, sd: null,
      imageColor: null, imageGrey: null, imageBinary: null,
      rotateRadians: null, pdf: null, debug: null,
    };
    const result = mapTesseractResult(page, 200, 200);
    expect(result.lines).toHaveLength(0);
    expect(result.words).toHaveLength(0);
    expect(result.confidence).toBeCloseTo(0.5, 2);
  });

  it("clamps confidence to 0–1 range", () => {
    const page = createSyntheticTtuPage();
    page.confidence = 150; // out of range
    const result = mapTesseractResult(page, 100, 100);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("handles negative confidence gracefully", () => {
    const page = createSyntheticTtuPage();
    page.confidence = -10;
    const result = mapTesseractResult(page, 100, 100);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });
});

// ── Bounding-box coordinate transformation ─────────────────────────────

describe("Bounding-box coordinate transformation", () => {
  it("transforms word and line bounding boxes from preprocessed space to original space", () => {
    // Exact user requirement scenario:
    // original = 400 × 200, processed = 1200 × 600
    // Tesseract bbox: x0=300, y0=150, x1=600, y1=300
    // Murattab output: x0=100, y0=50, x1=200, y1=100
    const rawWordBbox: Tesseract.Bbox = { x0: 300, y0: 150, x1: 600, y1: 300 };
    const rawLineBbox: Tesseract.Bbox = { x0: 300, y0: 150, x1: 600, y1: 300 };

    const testWord: Tesseract.Word = {
      text: "مرتب",
      confidence: 90,
      bbox: rawWordBbox,
      font_name: "Arial",
      symbols: [],
      choices: [],
    };

    const testLine: Tesseract.Line = {
      text: "مرتب",
      confidence: 90,
      bbox: rawLineBbox,
      baseline: { x0: 300, y0: 300, x1: 600, y1: 300 },
      rowAttributes: { ascenders: 0, descenders: 0, rowHeight: 150 },
      words: [testWord],
    };

    const mockPage: Tesseract.Page = {
      blocks: [
        {
          text: "مرتب\n",
          confidence: 90,
          bbox: rawLineBbox,
          blocktype: "PAGE",
          page: null as unknown as Tesseract.Page,
          paragraphs: [
            {
              text: "مرتب\n",
              confidence: 90,
              bbox: rawLineBbox,
              lines: [testLine],
              is_ltr: false,
            },
          ],
        },
      ],
      confidence: 90,
      text: "مرتب\n",
      oem: "LSTM_ONLY",
      osd: "",
      psm: "AUTO",
      version: "7.0.0",
      hocr: null, tsv: null, box: null, unlv: null, sd: null,
      imageColor: null, imageGrey: null, imageBinary: null,
      rotateRadians: null, pdf: null, debug: null,
    };

    const result = mapTesseractResult(
      mockPage,
      400,  // originalWidth
      200,  // originalHeight
      1200, // processedWidth
      600   // processedHeight
    );

    // Dimension report
    expect(result.width).toBe(400);
    expect(result.height).toBe(200);

    // Line bounding box transformed: (300, 150, 600, 300) * (400/1200, 200/600) = (100, 50, 200, 100)
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].bbox).toEqual({
      x0: 100,
      y0: 50,
      x1: 200,
      y1: 100,
    });

    // Word bounding box transformed identically
    expect(result.words).toHaveLength(1);
    expect(result.words[0].bbox).toEqual({
      x0: 100,
      y0: 50,
      x1: 200,
      y1: 100,
    });

    // Verify Tesseract input objects were NOT mutated
    expect(rawWordBbox).toEqual({ x0: 300, y0: 150, x1: 600, y1: 300 });
    expect(rawLineBbox).toEqual({ x0: 300, y0: 150, x1: 600, y1: 300 });
  });

  it("applies 1:1 mapping when image was not scaled", () => {
    const rawBbox: Tesseract.Bbox = { x0: 50, y0: 20, x1: 150, y1: 80 };
    const word: Tesseract.Word = {
      text: "ICT",
      confidence: 95,
      bbox: rawBbox,
      font_name: "Arial",
      symbols: [],
      choices: [],
    };
    const line: Tesseract.Line = {
      text: "ICT",
      confidence: 95,
      bbox: rawBbox,
      baseline: { x0: 50, y0: 80, x1: 150, y1: 80 },
      rowAttributes: { ascenders: 0, descenders: 0, rowHeight: 60 },
      words: [word],
    };
    const page: Tesseract.Page = {
      blocks: [
        {
          text: "ICT\n",
          confidence: 95,
          bbox: rawBbox,
          blocktype: "PAGE",
          page: null as unknown as Tesseract.Page,
          paragraphs: [{ text: "ICT\n", confidence: 95, bbox: rawBbox, lines: [line], is_ltr: true }],
        },
      ],
      confidence: 95,
      text: "ICT\n",
      oem: "LSTM_ONLY",
      osd: "",
      psm: "AUTO",
      version: "7.0.0",
      hocr: null, tsv: null, box: null, unlv: null, sd: null,
      imageColor: null, imageGrey: null, imageBinary: null,
      rotateRadians: null, pdf: null, debug: null,
    };

    const result = mapTesseractResult(page, 800, 600, 800, 600);
    expect(result.lines[0].bbox).toEqual({ x0: 50, y0: 20, x1: 150, y1: 80 });
    expect(result.words[0].bbox).toEqual({ x0: 50, y0: 20, x1: 150, y1: 80 });
  });
});

// ── OcrError ───────────────────────────────────────────────────────────

describe("OcrError", () => {
  it("has correct name and code", () => {
    const err = new OcrError("OCR_INITIALIZATION_FAILED", "test message");
    expect(err.name).toBe("OcrError");
    expect(err.code).toBe("OCR_INITIALIZATION_FAILED");
    expect(err.message).toBe("test message");
  });

  it("is an instance of Error", () => {
    const err = new OcrError("OCR_IMAGE_DECODE_FAILED", "decode error");
    expect(err).toBeInstanceOf(Error);
  });

  it("supports error cause", () => {
    const cause = new Error("root cause");
    const err = new OcrError("OCR_RECOGNITION_FAILED", "wrap", { cause });
    expect(err.cause).toBe(cause);
  });

  it("covers all error codes", () => {
    const codes = [
      "OCR_IMAGE_DECODE_FAILED",
      "OCR_INITIALIZATION_FAILED",
      "OCR_RECOGNITION_FAILED",
      "OCR_UNSUPPORTED_IMAGE",
      "OCR_IMAGE_TOO_LARGE",
    ] as const;
    for (const code of codes) {
      const err = new OcrError(code, code);
      expect(err.code).toBe(code);
    }
  });
});

// ── LocalOcrEngine lifecycle (mocked) ──────────────────────────────────

describe("LocalOcrEngine lifecycle", () => {
  let mockWorker: {
    recognize: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  };
  let createWorkerCallCount: number;

  beforeEach(() => {
    createWorkerCallCount = 0;
    mockWorker = {
      recognize: vi.fn().mockResolvedValue({
        jobId: "test",
        data: {
          blocks: [],
          confidence: 50,
          text: "test",
          oem: "LSTM_ONLY",
          psm: "AUTO",
          version: "7.0.0",
          hocr: null, tsv: null, box: null, unlv: null, sd: null,
          imageColor: null, imageGrey: null, imageBinary: null,
          rotateRadians: null, pdf: null, debug: null,
        },
      }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };

    // Mock tesseract.js module
    vi.doMock("tesseract.js", () => ({
      createWorker: vi.fn(async () => {
        createWorkerCallCount++;
        return mockWorker;
      }),
      OEM: {
        TESSERACT_ONLY: 0,
        LSTM_ONLY: 1,
        TESSERACT_LSTM_COMBINED: 2,
        DEFAULT: 3,
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lazily initializes worker on first recognize", async () => {
    const { LocalOcrEngine } = await import("@/domain/ocr/tesseract-engine");
    const engine = new LocalOcrEngine();

    // Worker not created yet
    expect(createWorkerCallCount).toBe(0);

    // We can't actually call recognizeImage without browser APIs (preprocessImage),
    // so we test the init logic through dispose
    await engine.dispose();
    expect(createWorkerCallCount).toBe(0); // still 0, never initialized
  });

  it("dispose is safe to call multiple times", async () => {
    const { LocalOcrEngine } = await import("@/domain/ocr/tesseract-engine");
    const engine = new LocalOcrEngine();

    // Should not throw
    await engine.dispose();
    await engine.dispose();
    await engine.dispose();
  });

  it("mapTesseractResult reuse does not create side effects", () => {
    const page = createSyntheticTtuPage();
    const r1 = mapTesseractResult(page, 800, 600);
    const r2 = mapTesseractResult(page, 800, 600);

    expect(r1.lines).toHaveLength(r2.lines.length);
    expect(r1.words).toHaveLength(r2.words.length);
    expect(r1.text).toBe(r2.text);
  });
});
