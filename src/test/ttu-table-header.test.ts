import { describe, it, expect } from "vitest";
import type { OcrBoundingBox, OcrImageResult, OcrLine, OcrWord } from "@/domain/ocr/types";
import { stripBidiControls, normalizeForMatching } from "@/domain/ttu-table/text-normalization";
import { detectHeaders } from "@/domain/ttu-table/header-detector";

function makeWord(text: string, x0: number, y0: number, x1: number, y1: number, confidence = 0.95): OcrWord {
  return { text, bbox: { x0, y0, x1, y1 }, confidence };
}

function makeLine(text: string, words: OcrWord[], confidence = 0.95): OcrLine {
  const x0 = Math.min(...words.map((w) => w.bbox.x0));
  const y0 = Math.min(...words.map((w) => w.bbox.y0));
  const x1 = Math.max(...words.map((w) => w.bbox.x1));
  const y1 = Math.max(...words.map((w) => w.bbox.y1));
  return { text, words, bbox: { x0, y0, x1, y1 }, confidence };
}

function makeOcr(lines: OcrLine[], width = 1000, height = 600): OcrImageResult {
  const words = lines.flatMap((l) => l.words);
  return {
    text: lines.map((l) => l.text).join("\n"),
    confidence: 0.95,
    width,
    height,
    lines,
    words,
  };
}

describe("Text Normalization & Bidi Safety", () => {
  it("strips invisible Unicode bidirectional control characters", () => {
    // \u200E (LRM), \u200F (RLM), \u202A (LRE), \u202C (PDF)
    const rawWithBidi = "\u200Eمرتب\u200F \u202AICT 4\u202C";
    const cleaned = stripBidiControls(rawWithBidi);
    expect(cleaned).toBe("مرتب ICT 4");
    expect(cleaned).not.toContain("\u200E");
    expect(cleaned).not.toContain("\u200F");
  });

  it("normalizes Arabic variants and separators for matching only", () => {
    expect(normalizeForMatching("إسم  المادّة")).toBe("اسم الماده");
    expect(normalizeForMatching("س.م")).toBe("س م");
    expect(normalizeForMatching("الـقـاعـة")).toBe("القاعه"); // kashida stripped, teh marbuta normalized
    expect(normalizeForMatching("  مَوْعِدُ الْمُحَاضَرَةِ  ")).toBe("موعد المحاضره");
  });

  it("preserves English text case-insensitively and cleans punctuation", () => {
    expect(normalizeForMatching("DS-ICT 3")).toBe("ds ict 3");
    expect(normalizeForMatching("10:00 - 11:00")).toBe("10 00 11 00");
  });
});

describe("Header Detector — Band-Level Evidence & Aliases", () => {
  it("detects full standard TTU header row clustered in a vertical band", () => {
    // Physical RTL header: [القاعة] [الموعد] [س.م] [الشعبة] [اسم المادة]
    const w1 = makeWord("القاعة", 50, 40, 150, 70);
    const w2 = makeWord("الموعد", 200, 40, 320, 70);
    const w3 = makeWord("س.م", 380, 40, 450, 70);
    const w4 = makeWord("الشعبة", 500, 40, 600, 70);
    const w5 = makeWord("اسم", 680, 40, 750, 70);
    const w6 = makeWord("المادة", 760, 40, 850, 70);

    const l1 = makeLine("القاعة", [w1]);
    const l2 = makeLine("الموعد", [w2]);
    const l3 = makeLine("س.م", [w3]);
    const l4 = makeLine("الشعبة", [w4]);
    const l5 = makeLine("اسم المادة", [w5, w6]);

    const ocr = makeOcr([l1, l2, l3, l4, l5]);
    const result = detectHeaders(ocr, 30);

    expect(result.headers.length).toBe(5);
    expect(result.headerBand).not.toBeNull();
    expect(result.headerBand?.y0).toBe(40);
    expect(result.headerBand?.y1).toBe(70);

    const keys = result.headers.map((h) => h.key);
    expect(keys).toContain("room");
    expect(keys).toContain("meeting");
    expect(keys).toContain("creditHours");
    expect(keys).toContain("section");
    expect(keys).toContain("courseName");

    // Raw text preserved exactly
    const courseHeader = result.headers.find((h) => h.key === "courseName");
    expect(courseHeader?.rawText).toBe("اسم المادة");

    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("REJECTS an isolated short alias (e.g. 'مادة') if not supported by a header band", () => {
    // An isolated occurrence of "مادة" in text (e.g. in notes or page header)
    const w = makeWord("مادة", 100, 20, 160, 45);
    const line = makeLine("مادة", [w]);
    const ocr = makeOcr([line]);

    const result = detectHeaders(ocr, 25);
    expect(result.headers).toHaveLength(0);
    expect(result.headerBand).toBeNull();
    expect(result.issues.some((i) => i.code === "HEADER_NOT_FOUND")).toBe(true);
    expect(result.confidence).toBe(0);
  });

  it("REJECTS an isolated 'قاعة' or 'وقت' outside a table header", () => {
    const w = makeWord("قاعة", 300, 50, 360, 75);
    const line = makeLine("قاعة", [w]);
    const ocr = makeOcr([line]);

    const result = detectHeaders(ocr, 25);
    expect(result.headers).toHaveLength(0);
    expect(result.issues.some((i) => i.code === "HEADER_NOT_FOUND")).toBe(true);
  });

  it("detects partial header and issues a HEADER_PARTIAL warning", () => {
    // Only courseName and meeting present, room is missing
    const w1 = makeWord("المادة", 600, 30, 720, 60);
    const w2 = makeWord("الوقت", 200, 30, 300, 60);

    const l1 = makeLine("المادة", [w1]);
    const l2 = makeLine("الوقت", [w2]);

    const ocr = makeOcr([l1, l2]);
    const result = detectHeaders(ocr, 30);

    expect(result.headers.length).toBe(2);
    expect(result.issues.some((i) => i.code === "HEADER_PARTIAL")).toBe(true);
    expect(result.confidence).toBeLessThan(0.9);
  });
});
