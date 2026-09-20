import { describe, it, expect } from "vitest";
import type { OcrBoundingBox, OcrWord } from "@/domain/ocr/types";
import type { TtuTableColumn } from "@/domain/ttu-table/types";
import { detectRowBands } from "@/domain/ttu-table/row-detector";

function makeWord(text: string, x0: number, y0: number, x1: number, y1: number): OcrWord {
  return { text, bbox: { x0, y0, x1, y1 }, confidence: 0.95 };
}

const COLUMNS: TtuTableColumn[] = [
  { key: "room", headerText: "القاعة", bbox: { x0: 50, y0: 30, x1: 150, y1: 60 }, xStart: 0, xEnd: 200, confidence: 0.95 },
  { key: "meeting", headerText: "الموعد", bbox: { x0: 250, y0: 30, x1: 350, y1: 60 }, xStart: 200, xEnd: 450, confidence: 0.95 },
  { key: "creditHours", headerText: "س.م", bbox: { x0: 480, y0: 30, x1: 540, y1: 60 }, xStart: 450, xEnd: 600, confidence: 0.95 },
  { key: "section", headerText: "الشعبة", bbox: { x0: 630, y0: 30, x1: 700, y1: 60 }, xStart: 600, xEnd: 750, confidence: 0.95 },
  { key: "courseName", headerText: "اسم المادة", bbox: { x0: 780, y0: 30, x1: 900, y1: 60 }, xStart: 750, xEnd: 1000, confidence: 0.95 },
];

describe("TTU Row Detector — Anchors & Multi-Segment Grouping", () => {
  it("keeps a multi-line course (Lecture + Lab) as ONE logical row band", () => {
    // Row 1: تصور البيانات (has lecture + lab)
    // Course name centered around y=100..130 in courseName column [750..1000]
    const c1w1 = makeWord("تصور", 800, 100, 850, 130);
    const c1w2 = makeWord("البيانات", 860, 100, 950, 130);

    // Lecture meeting line (y=90..115)
    const m1w1 = makeWord("ح", 220, 90, 240, 115);
    const m1w2 = makeWord("ث", 250, 90, 270, 115);
    const m1w3 = makeWord("خ", 280, 90, 300, 115);
    const m1t = makeWord("10:00 - 11:00", 310, 90, 440, 115);

    // Lecture room line (y=90..115)
    const r1 = makeWord("207 م", 60, 90, 140, 115);

    // Lab meeting line (y=130..155) - still part of same course!
    const m2w = makeWord("ن", 220, 130, 240, 155);
    const m2t = makeWord("08:30 - 10:30", 250, 130, 380, 155);

    // Lab room line (y=130..155)
    const r2w1 = makeWord("ICT", 60, 130, 100, 155);
    const r2w2 = makeWord("-", 105, 130, 115, 155);
    const r2w3 = makeWord("4", 120, 130, 140, 155);

    // Row 2: التعلم الآلي (starts below at y=200)
    const c2w1 = makeWord("التعلم", 800, 200, 860, 230);
    const c2w2 = makeWord("الآلي", 870, 200, 930, 230);
    const m3 = makeWord("ن ر 11:30 - 13:00", 220, 200, 390, 230);
    const r3 = makeWord("DS-ICT 3", 60, 200, 150, 230);

    const bodyWords = [
      c1w1, c1w2, m1w1, m1w2, m1w3, m1t, r1, m2w, m2t, r2w1, r2w2, r2w3,
      c2w1, c2w2, m3, r3
    ];

    const result = detectRowBands(bodyWords, COLUMNS, 60, 25);

    // Exactly 2 logical row bands!
    expect(result.rowBands).toHaveLength(2);

    // First row band spans from headerBottom (60) to midpoint between course anchors (~165)
    expect(result.rowBands[0].index).toBe(0);
    expect(result.rowBands[0].yTop).toBe(60);
    expect(result.rowBands[0].yBottom).toBeGreaterThan(155); // encompasses the lab lines!
    expect(result.rowBands[0].yBottom).toBeLessThan(200);   // ends before row 2 starts!

    // Second row band spans for the second course
    expect(result.rowBands[1].index).toBe(1);
    expect(result.rowBands[1].yTop).toBe(result.rowBands[0].yBottom);
    expect(result.rowBands[1].yBottom).toBeGreaterThan(230);
  });

  it("detects and excludes footer text below the last row band", () => {
    // Row 1: شبكات الحاسوب (y=100..130)
    const c1 = makeWord("شبكات الحاسوب", 780, 100, 920, 130);
    const m1 = makeWord("ح ث 08:30 - 10:00", 220, 100, 390, 130);

    // Footer text far below at y=450 (e.g. print timestamp / notes)
    const footer1 = makeWord("تاريخ", 400, 450, 450, 475);
    const footer2 = makeWord("الطباعة: 2026/09/20", 460, 450, 650, 475);
    const footer3 = makeWord("صفحة 1 من 1", 700, 450, 820, 475);

    const bodyWords = [c1, m1, footer1, footer2, footer3];

    const result = detectRowBands(bodyWords, COLUMNS, 60, 25);

    expect(result.rowBands).toHaveLength(1);
    expect(result.footerDetected).toBe(true);

    // The single row's bottom must NOT include y=450
    expect(result.rowBands[0].yBottom).toBeLessThan(300);
    expect(result.tableBottom).toBeLessThan(300);
  });

  it("REGRESSION: Does not prematurely treat subsequent courses as footer when multi-session gap is large", () => {
    // 4 courses where row 2 is multi-session, creating a ~115px gap between course title 1 and 2
    // Median line height is 24. A threshold of 4 * medianLineHeight (96px) would fail here.
    const c1 = makeWord("تصميم الدوائر المنطقية", 780, 100, 950, 125);
    const c2 = makeWord("تصور البيانات", 780, 240, 920, 265); // gap = 240 - 125 = 115px
    const c3 = makeWord("التعلم الآلي", 780, 360, 900, 385);
    const c4 = makeWord("شبكات الحاسوب", 780, 460, 930, 485);

    // Footer with mixed token ordering (date word appears at leftmost position)
    const f1 = makeWord("2026/09/20", 300, 600, 420, 625);
    const f2 = makeWord("تاريخ الطباعة", 450, 600, 580, 625);

    const bodyWords = [c1, c2, c3, c4, f1, f2];
    const result = detectRowBands(bodyWords, COLUMNS, 60, 24);

    // Must recognize all 4 courses!
    expect(result.rowBands).toHaveLength(4);
    expect(result.footerDetected).toBe(true);

    // Last course row bottom must exclude y=600 footer
    expect(result.rowBands[3].yBottom).toBeLessThan(550);
  });

  it("REGRESSION: metadata row cues split a multiline course title from the immediately following course", () => {
    // This reproduces the real TTU failure mode:
    //
    //   مختبر قواعد البيانات
    //   المهيكلة
    //   تصور البيانات
    //
    // The vertical gaps are intentionally tiny, so the old gap-only algorithm
    // would merge all three visual lines into a single course anchor.
    const c1Line1a = makeWord("مختبر", 800, 100, 850, 116);
    const c1Line1b = makeWord("قواعد", 855, 100, 900, 116);
    const c1Line1c = makeWord("البيانات", 905, 100, 970, 116);
    const c1Line2 = makeWord("المهيكلة", 835, 118, 930, 134);

    const c2a = makeWord("تصور", 815, 136, 860, 152);
    const c2b = makeWord("البيانات", 865, 136, 940, 152);

    // Corroborated metadata cues: section + credit-hours each provide one
    // single-value anchor per logical course row.
    const row1Section = makeWord("1", 650, 112, 665, 128);
    const row1Credits = makeWord("3", 500, 112, 515, 128);
    const row2Section = makeWord("2", 650, 140, 665, 156);
    const row2Credits = makeWord("3", 500, 140, 515, 156);

    const bodyWords = [
      c1Line1a,
      c1Line1b,
      c1Line1c,
      c1Line2,
      c2a,
      c2b,
      row1Section,
      row1Credits,
      row2Section,
      row2Credits,
    ];

    const result = detectRowBands(bodyWords, COLUMNS, 60, 24);

    expect(result.rowBands).toHaveLength(2);

    // Boundary must fall between the two logical courses even though the
    // printed course-name lines are only 2px apart.
    expect(result.rowBands[0].yBottom).toBeGreaterThanOrEqual(134);
    expect(result.rowBands[0].yBottom).toBeLessThan(136 + 8);
    expect(result.rowBands[1].yTop).toBe(result.rowBands[0].yBottom);
  });

  it("keeps two visual title lines in one course when metadata places both inside the same row", () => {
    const c1Line1 = makeWord("مختبر قواعد البيانات", 800, 100, 970, 116);
    const c1Line2 = makeWord("المهيكلة", 835, 118, 930, 134);
    const c2 = makeWord("التعلم الآلي", 820, 180, 930, 196);

    const row1Section = makeWord("1", 650, 112, 665, 128);
    const row1Credits = makeWord("3", 500, 112, 515, 128);
    const row2Section = makeWord("2", 650, 184, 665, 200);
    const row2Credits = makeWord("3", 500, 184, 515, 200);

    const result = detectRowBands(
      [
        c1Line1,
        c1Line2,
        c2,
        row1Section,
        row1Credits,
        row2Section,
        row2Credits,
      ],
      COLUMNS,
      60,
      24
    );

    expect(result.rowBands).toHaveLength(2);
    expect(result.rowBands[0].yBottom).toBeGreaterThan(134);
    expect(result.rowBands[0].yBottom).toBeLessThan(180);
  });

});