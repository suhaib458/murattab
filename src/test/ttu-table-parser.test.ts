import { describe, it, expect } from "vitest";
import type { OcrBoundingBox, OcrImageResult, OcrLine, OcrWord } from "@/domain/ocr/types";
import { parseTtuTableGeometry } from "@/domain/ttu-table/parser";

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

// ── Synthetic Fixture Generators ───────────────────────────────────────

/**
 * Standard TTU schedule layout helper.
 * Columns (Physical RTL: room | meeting | creditHours | section | courseName):
 *   room: [0..200]
 *   meeting: [200..450]
 *   creditHours: [450..580]
 *   section: [580..720]
 *   courseName: [720..1000]
 */
function createStandardTtuOcr(scale = 1.0, includeFooter = false): OcrImageResult {
  const s = (val: number) => Math.round(val * scale);

  // Headers (y = 30..60)
  const hRoom = makeLine("القاعة", [makeWord("القاعة", s(60), s(30), s(140), s(60))]);
  const hMeeting = makeLine("الموعد", [makeWord("الموعد", s(280), s(30), s(370), s(60))]);
  const hCredit = makeLine("س.م", [makeWord("س.م", s(490), s(30), s(540), s(60))]);
  const hSec = makeLine("الشعبة", [makeWord("الشعبة", s(620), s(30), s(680), s(60))]);
  const hCourse = makeLine("اسم المادة", [
    makeWord("اسم", s(780), s(30), s(830), s(60)),
    makeWord("المادة", s(840), s(30), s(920), s(60)),
  ]);

  const lines: OcrLine[] = [hRoom, hMeeting, hCredit, hSec, hCourse];

  // ── Row 1: Case A — تصميم الدوائر المنطقية (y=100..130) ───────────────
  const r1Course = makeLine("تصميم الدوائر المنطقية", [
    makeWord("تصميم", s(750), s(100), s(810), s(130)),
    makeWord("الدوائر", s(820), s(100), s(890), s(130)),
    makeWord("المنطقية", s(900), s(100), s(980), s(130)),
  ]);
  const r1Sec = makeLine("1", [makeWord("1", s(640), s(100), s(660), s(130))]);
  const r1Cred = makeLine("3", [makeWord("3", s(505), s(100), s(525), s(130))]);
  const r1Meet = makeLine("ح ث 11:30 - 13:00", [
    makeWord("ح", s(220), s(100), s(240), s(130)),
    makeWord("ث", s(250), s(100), s(270), s(130)),
    makeWord("11:30", s(280), s(100), s(340), s(130)),
    makeWord("-", s(345), s(100), s(355), s(130)),
    makeWord("13:00", s(360), s(100), s(420), s(130)),
  ]);
  const r1Room = makeLine("DS-ICT 2", [
    makeWord("DS-ICT", s(60), s(100), s(130), s(130)),
    makeWord("2", s(140), s(100), s(160), s(130)),
  ]);
  lines.push(r1Course, r1Sec, r1Cred, r1Meet, r1Room);

  // ── Row 2: Case B — تصور البيانات (Lecture + Lab multi-segment) ────────
  const r2Course = makeLine("تصور البيانات", [
    makeWord("تصور", s(780), s(200), s(840), s(230)),
    makeWord("البيانات", s(850), s(200), s(940), s(230)),
  ]);
  const r2Sec = makeLine("1", [makeWord("1", s(640), s(200), s(660), s(230))]);
  const r2Cred = makeLine("3", [makeWord("3", s(505), s(200), s(525), s(230))]);
  // Lecture segment (y=190..215)
  const r2MeetLec = makeLine("ح ث خ 10:00 - 11:00", [
    makeWord("ح", s(220), s(190), s(240), s(215)),
    makeWord("ث", s(250), s(190), s(270), s(215)),
    makeWord("خ", s(280), s(190), s(300), s(215)),
    makeWord("10:00", s(310), s(190), s(365), s(215)),
    makeWord("-", s(370), s(190), s(380), s(215)),
    makeWord("11:00", s(385), s(190), s(440), s(215)),
  ]);
  const r2RoomLec = makeLine("207 م", [
    makeWord("207", s(60), s(190), s(110), s(215)),
    makeWord("م", s(120), s(190), s(140), s(215)),
  ]);
  // Lab segment (y=230..255)
  const r2MeetLab = makeLine("ن 08:30 - 10:30", [
    makeWord("ن", s(220), s(230), s(240), s(255)),
    makeWord("08:30", s(250), s(230), s(310), s(255)),
    makeWord("-", s(315), s(230), s(325), s(255)),
    makeWord("10:30", s(330), s(230), s(390), s(255)),
  ]);
  const r2RoomLab = makeLine("ICT - 4", [
    makeWord("ICT", s(60), s(230), s(105), s(255)),
    makeWord("-", s(110), s(230), s(120), s(255)),
    makeWord("4", s(125), s(230), s(145), s(255)),
  ]);
  lines.push(r2Course, r2Sec, r2Cred, r2MeetLec, r2RoomLec, r2MeetLab, r2RoomLab);

  // ── Row 3: Case C — التعلم الآلي (y=320..350) ─────────────────────────
  const r3Course = makeLine("التعلم الآلي", [
    makeWord("التعلم", s(780), s(320), s(850), s(350)),
    makeWord("الآلي", s(860), s(320), s(920), s(350)),
  ]);
  const r3Sec = makeLine("2", [makeWord("2", s(640), s(320), s(660), s(350))]);
  const r3Cred = makeLine("3", [makeWord("3", s(505), s(320), s(525), s(350))]);
  const r3Meet = makeLine("ن ر 11:30 - 13:00", [
    makeWord("ن", s(220), s(320), s(240), s(350)),
    makeWord("ر", s(250), s(320), s(270), s(350)),
    makeWord("11:30", s(280), s(320), s(340), s(350)),
    makeWord("-", s(345), s(320), s(355), s(350)),
    makeWord("13:00", s(360), s(320), s(420), s(350)),
  ]);
  const r3Room = makeLine("DS-ICT 3", [
    makeWord("DS-ICT", s(60), s(320), s(130), s(350)),
    makeWord("3", s(140), s(320), s(160), s(350)),
  ]);
  lines.push(r3Course, r3Sec, r3Cred, r3Meet, r3Room);

  // ── Row 4: Case D — شبكات الحاسوب (y=420..450) ────────────────────────
  const r4Course = makeLine("شبكات الحاسوب", [
    makeWord("شبكات", s(780), s(420), s(845), s(450)),
    makeWord("الحاسوب", s(855), s(420), s(940), s(450)),
  ]);
  const r4Sec = makeLine("1", [makeWord("1", s(640), s(420), s(660), s(450))]);
  const r4Cred = makeLine("3", [makeWord("3", s(505), s(420), s(525), s(450))]);
  const r4Meet = makeLine("ح ث 08:30 - 10:00", [
    makeWord("ح", s(220), s(420), s(240), s(450)),
    makeWord("ث", s(250), s(420), s(270), s(450)),
    makeWord("08:30", s(280), s(420), s(340), s(450)),
    makeWord("-", s(345), s(420), s(355), s(450)),
    makeWord("10:00", s(360), s(420), s(420), s(450)),
  ]);
  const r4Room = makeLine("DS-ICT 3", [
    makeWord("DS-ICT", s(60), s(420), s(130), s(450)),
    makeWord("3", s(140), s(420), s(160), s(450)),
  ]);
  lines.push(r4Course, r4Sec, r4Cred, r4Meet, r4Room);

  // ── Optional Footer (y=650..680) ─────────────────────────────────────
  if (includeFooter) {
    const footer = makeLine("تاريخ الطباعة 2026/09/20 - صفحة 1 من 1", [
      makeWord("تاريخ", s(300), s(650), s(360), s(680)),
      makeWord("الطباعة", s(370), s(650), s(440), s(680)),
      makeWord("2026/09/20", s(450), s(650), s(560), s(680)),
      makeWord("-", s(570), s(650), s(580), s(680)),
      makeWord("صفحة", s(590), s(650), s(640), s(680)),
      makeWord("1", s(650), s(650), s(665), s(680)),
      makeWord("من", s(675), s(650), s(700), s(680)),
      makeWord("1", s(710), s(650), s(725), s(680)),
    ]);
    lines.push(footer);
  }

  const words = lines.flatMap((l) => l.words);
  return {
    text: lines.map((l) => l.text).join("\n"),
    confidence: 0.95,
    width: s(1000),
    height: s(includeFooter ? 750 : 550),
    lines,
    words,
  };
}

describe("TTU Table Geometry Parser — Full Pipeline", () => {
  it("CASE A: Parses simple one-line rows correctly", () => {
    const ocr = createStandardTtuOcr(1.0);
    const result = parseTtuTableGeometry(ocr);

    expect(result.columns.length).toBe(5);
    expect(result.rows.length).toBe(4);

    const row0 = result.rows[0];
    expect(row0.cells.courseName?.rawText).toBe("تصميم الدوائر المنطقية");
    expect(row0.cells.section?.rawText).toBe("1");
    expect(row0.cells.creditHours?.rawText).toBe("3");
    expect(row0.cells.meeting?.rawText).toBe("ح ث 11:30 - 13:00");
    expect(row0.cells.room?.rawText).toBe("DS-ICT 2");
  });

  it("CASE B: Keeps multi-segment course row as ONE row with ordered segments", () => {
    const ocr = createStandardTtuOcr(1.0);
    const result = parseTtuTableGeometry(ocr);

    // Row 1 is "تصور البيانات"
    const row1 = result.rows[1];
    expect(row1.cells.courseName?.rawText).toBe("تصور البيانات");

    // Meeting must have 2 vertical segments!
    const meetingCell = row1.cells.meeting;
    expect(meetingCell).toBeDefined();
    expect(meetingCell?.segments).toHaveLength(2);
    expect(meetingCell?.segments[0].text).toBe("ح ث خ 10:00 - 11:00");
    expect(meetingCell?.segments[1].text).toBe("ن 08:30 - 10:30");
    expect(meetingCell?.rawText).toBe("ح ث خ 10:00 - 11:00\nن 08:30 - 10:30");

    // Room must have 2 vertical segments!
    const roomCell = row1.cells.room;
    expect(roomCell).toBeDefined();
    expect(roomCell?.segments).toHaveLength(2);
    expect(roomCell?.segments[0].text).toBe("207 م");
    expect(roomCell?.segments[1].text).toBe("ICT - 4");
    expect(roomCell?.rawText).toBe("207 م\nICT - 4");
  });

  it("CASE C: Preserves both day letters ('ن', 'ر') for التعلم الآلي", () => {
    const ocr = createStandardTtuOcr(1.0);
    const result = parseTtuTableGeometry(ocr);

    const row2 = result.rows[2];
    expect(row2.cells.courseName?.rawText).toBe("التعلم الآلي");
    expect(row2.cells.meeting?.rawText).toContain("ن");
    expect(row2.cells.meeting?.rawText).toContain("ر");
    expect(row2.cells.meeting?.rawText).toBe("ن ر 11:30 - 13:00");
    expect(row2.cells.room?.rawText).toBe("DS-ICT 3");
  });

  it("CASE D: Ensures no extra day token ('خ') is invented for شبكات الحاسوب", () => {
    const ocr = createStandardTtuOcr(1.0);
    const result = parseTtuTableGeometry(ocr);

    const row3 = result.rows[3];
    expect(row3.cells.courseName?.rawText).toBe("شبكات الحاسوب");
    expect(row3.cells.meeting?.rawText).toBe("ح ث 08:30 - 10:00");
    expect(row3.cells.meeting?.rawText).not.toContain("خ");
  });

  it("CASE E: Returns structured warning for partial/missing header without guessing", () => {
    // Only courseName and section present (missing meeting & room core anchors)
    const hCourse = makeLine("المادة", [makeWord("المادة", 750, 30, 850, 60)]);
    const hSec = makeLine("الشعبة", [makeWord("الشعبة", 500, 30, 580, 60)]);
    const body = makeLine("برمجة 1", [
      makeWord("برمجة", 750, 100, 820, 130),
      makeWord("1", 520, 100, 540, 130),
    ]);

    const ocr = {
      text: "المادة الشعبة\nبرمجة 1",
      confidence: 0.8,
      width: 1000,
      height: 400,
      lines: [hCourse, hSec, body],
      words: [...hCourse.words, ...hSec.words, ...body.words],
    };

    const result = parseTtuTableGeometry(ocr);
    expect(result.issues.some((i) => i.code === "HEADER_PARTIAL")).toBe(true);
    expect(result.confidence).toBeLessThan(0.8);
  });

  it("CASE F: Preserves mixed Arabic/English and Bidi text in rawText without mutation", () => {
    // Create OCR containing bidi control characters in the raw strings
    const bidiRoom = "\u200EICT - 4\u200F";
    const bidiCourse = "\u200Eتصور البيانات\u200F";

    const hRoom = makeLine("القاعة", [makeWord("القاعة", 100, 30, 200, 60)]);
    const hCourse = makeLine("اسم المادة", [makeWord("اسم المادة", 600, 30, 800, 60)]);

    const wRoom = makeWord(bidiRoom, 100, 100, 220, 130);
    const wCourse = makeWord(bidiCourse, 600, 100, 820, 130);

    const lRoom = makeLine(bidiRoom, [wRoom]);
    const lCourse = makeLine(bidiCourse, [wCourse]);

    const ocr = {
      text: "القاعة اسم المادة\n...",
      confidence: 0.95,
      width: 1000,
      height: 400,
      lines: [hRoom, hCourse, lRoom, lCourse],
      words: [hRoom.words[0], hCourse.words[0], wRoom, wCourse],
    };

    const result = parseTtuTableGeometry(ocr);
    expect(result.rows).toHaveLength(1);

    // Stored rawText must preserve the original tokens exactly
    expect(result.rows[0].cells.room?.rawText).toBe(bidiRoom);
    expect(result.rows[0].cells.courseName?.rawText).toBe(bidiCourse);
  });

  it("Refinement 1: Word geometry prevents full OCR line spanning multiple columns from leaking into one cell", () => {
    // Simulate Tesseract incorrectly grouping courseName + meeting + room into a single OcrLine!
    const hRoom = makeLine("القاعة", [makeWord("القاعة", 50, 30, 150, 60)]);
    const hMeeting = makeLine("الموعد", [makeWord("الموعد", 250, 30, 350, 60)]);
    const hCourse = makeLine("المادة", [makeWord("المادة", 700, 30, 850, 60)]);

    // The single leaked OCR line:
    const wRoom = makeWord("ICT 4", 60, 100, 140, 130);
    const wMeet = makeWord("ح ث 10:00", 250, 100, 370, 130);
    const wCourse = makeWord("ذكاء اصطناعي", 710, 100, 880, 130);

    // This single line has text spanning everything:
    const singleSpanningLine: OcrLine = {
      text: "ICT 4 ح ث 10:00 ذكاء اصطناعي",
      confidence: 0.9,
      bbox: { x0: 60, y0: 100, x1: 880, y1: 130 },
      words: [wRoom, wMeet, wCourse],
    };

    const ocr: OcrImageResult = {
      text: "القاعة الموعد المادة\n...",
      confidence: 0.9,
      width: 1000,
      height: 400,
      lines: [hRoom, hMeeting, hCourse, singleSpanningLine],
      words: [hRoom.words[0], hMeeting.words[0], hCourse.words[0], wRoom, wMeet, wCourse],
    };

    const result = parseTtuTableGeometry(ocr);
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0];
    // Each cell MUST only contain its own words — NEVER the full line text!
    expect(row.cells.room?.rawText).toBe("ICT 4");
    expect(row.cells.meeting?.rawText).toBe("ح ث 10:00");
    expect(row.cells.courseName?.rawText).toBe("ذكاء اصطناعي");
  });

  it("Refinement 4: Excludes footer text below the last row band", () => {
    const ocrWithFooter = createStandardTtuOcr(1.0, true);
    const result = parseTtuTableGeometry(ocrWithFooter);

    // Should have exactly 4 course rows (footer is NOT a course row)
    expect(result.rows).toHaveLength(4);

    // Verify footer text is not attached to row 3 (شبكات الحاسوب)
    const lastRow = result.rows[3];
    expect(lastRow.cells.courseName?.rawText).toBe("شبكات الحاسوب");
    expect(lastRow.cells.room?.rawText).not.toContain("تاريخ");
    expect(lastRow.cells.meeting?.rawText).not.toContain("الطباعة");

    // An issue with code FOOTER_DETECTED should be present
    expect(result.issues.some((i) => i.code === "FOOTER_DETECTED")).toBe(true);
  });

  it("Refinement 2 & Scale Invariance: Exact same table at 800x400 and 1600x800 yields structurally identical results", () => {
    const ocr800 = createStandardTtuOcr(0.8);  // scaled to 800x440
    const ocr1600 = createStandardTtuOcr(1.6); // scaled to 1600x880

    const res800 = parseTtuTableGeometry(ocr800);
    const res1600 = parseTtuTableGeometry(ocr1600);

    // Same column count and keys in same order
    expect(res800.columns.map((c) => c.key)).toEqual(res1600.columns.map((c) => c.key));

    // Same row count
    expect(res800.rows.length).toBe(res1600.rows.length);

    // For every row and cell, rawText must match exactly!
    for (let i = 0; i < res800.rows.length; i++) {
      const r800 = res800.rows[i];
      const r1600 = res1600.rows[i];

      expect(r800.cells.courseName?.rawText).toBe(r1600.cells.courseName?.rawText);
      expect(r800.cells.section?.rawText).toBe(r1600.cells.section?.rawText);
      expect(r800.cells.creditHours?.rawText).toBe(r1600.cells.creditHours?.rawText);
      expect(r800.cells.meeting?.rawText).toBe(r1600.cells.meeting?.rawText);
      expect(r800.cells.room?.rawText).toBe(r1600.cells.room?.rawText);

      // Segment counts must match
      expect(r800.cells.meeting?.segments.length).toBe(r1600.cells.meeting?.segments.length);
      expect(r800.cells.room?.segments.length).toBe(r1600.cells.room?.segments.length);
    }
  });

  it("Pure geometry only: Does NOT interpret days, times, or rooms semantically", () => {
    const ocr = createStandardTtuOcr(1.0);
    const result = parseTtuTableGeometry(ocr);

    const firstRow = result.rows[0];
    // Meeting cell contains raw string "ح ث 11:30 - 13:00"
    expect(firstRow.cells.meeting?.rawText).toBe("ح ث 11:30 - 13:00");
    // No Sunday/Tuesday or startsAt properties exist on TtuTableCell
    expect((firstRow.cells.meeting as any).days).toBeUndefined();
    expect((firstRow.cells.meeting as any).startsAt).toBeUndefined();
    expect((firstRow.cells.meeting as any).endsAt).toBeUndefined();
    expect((firstRow.cells.room as any).isLab).toBeUndefined();
  });
});
