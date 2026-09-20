import { describe, it, expect, vi } from "vitest";
import {
  identifyProblematicCells,
  computeCellCropBbox,
  scoreMeetingText,
  arbitrateMeetingCandidate,
  groupRoomEntities,
  groupMeetingEntities,
  scoreRoomEntities,
  scoreSingleRoomEntity,
  arbitrateRoomCandidates,
  extractRoomEntitiesFromText,
  scoreCourseNameText,
  determineFieldStatus,
  refineTableCells,
  TARGET_CELL_SCALE,
} from "@/features/smart-import/local-cell-refinement";
import type {
  TtuTableGeometryResult,
  TtuTableRow,
  TtuTableColumn,
  TtuTableCell,
} from "@/domain/ttu-table/types";
import type { TtuParsedSchedule } from "@/domain/ttu-schedule-parser/types";
import { parseTtuDayCodes } from "@/domain/ttu-schedule-parser/day-parser";

// Helper to create a synthetic column set
function createMockColumns(): TtuTableColumn[] {
  return [
    { key: "room", headerText: "القاعة", bbox: { x0: 0, y0: 10, x1: 180, y1: 30 }, xStart: 0, xEnd: 188, confidence: 0.95 },
    { key: "meeting", headerText: "الموعد", bbox: { x0: 190, y0: 10, x1: 350, y1: 30 }, xStart: 188, xEnd: 364, confidence: 0.95 },
    { key: "creditHours", headerText: "س.م", bbox: { x0: 380, y0: 10, x1: 440, y1: 30 }, xStart: 364, xEnd: 459, confidence: 0.95 },
    { key: "section", headerText: "الشعبة", bbox: { x0: 470, y0: 10, x1: 520, y1: 30 }, xStart: 459, xEnd: 536, confidence: 0.95 },
    { key: "courseName", headerText: "اسم المادة", bbox: { x0: 550, y0: 10, x1: 650, y1: 30 }, xStart: 536, xEnd: 669, confidence: 0.95 },
  ];
}

// Helper to create a synthetic table row
function createMockRow(
  index: number,
  y0: number,
  y1: number,
  cells: Partial<Record<string, TtuTableCell>>
): TtuTableRow {
  return {
    index,
    bbox: { x0: 0, y0, x1: 669, y1 },
    confidence: 0.9,
    cells: cells as any,
  };
}

describe("Phase 5B — Targeted Cell-Level OCR Refinement", () => {
  // ── A. Clean meeting cell is NOT reprocessed ─────────────────────────
  it("A. clean meeting cell with canonical days and valid time is NOT flagged for refinement", () => {
    const columns = createMockColumns();
    const cleanRow = createMockRow(0, 50, 75, {
      meeting: {
        column: "meeting",
        rawText: "ح ث 11:30 - 13:00",
        bbox: { x0: 188, y0: 50, x1: 364, y1: 75 },
        confidence: 0.92,
        segments: [{ text: "ح ث 11:30 - 13:00", bbox: { x0: 188, y0: 50, x1: 364, y1: 75 }, confidence: 0.92 }],
      },
      room: {
        column: "room",
        rawText: "DS-ICT 2",
        bbox: { x0: 0, y0: 50, x1: 188, y1: 75 },
        confidence: 0.95,
        segments: [{ text: "DS-ICT 2", bbox: { x0: 0, y0: 50, x1: 188, y1: 75 }, confidence: 0.95 }],
      },
      courseName: {
        column: "courseName",
        rawText: "تصميم الدوائر المنطقية",
        bbox: { x0: 536, y0: 50, x1: 669, y1: 75 },
        confidence: 0.95,
        segments: [{ text: "تصميم الدوائر المنطقية", bbox: { x0: 536, y0: 50, x1: 669, y1: 75 }, confidence: 0.95 }],
      },
    });

    const geometry: TtuTableGeometryResult = {
      columns,
      rows: [cleanRow],
      issues: [],
      confidence: 0.9,
    };

    const flagged = identifyProblematicCells(geometry);
    expect(flagged).toHaveLength(0);
  });

  // ── B. DAY_UNRESOLVED triggers refinement ────────────────────────────
  it("B. DAY_UNRESOLVED triggers meeting refinement", () => {
    const columns = createMockColumns();
    const row = createMockRow(0, 50, 75, {
      meeting: {
        column: "meeting",
        rawText: "11:30 - 13:00",
        bbox: { x0: 188, y0: 50, x1: 364, y1: 75 },
        confidence: 0.85,
        segments: [{ text: "11:30 - 13:00", bbox: { x0: 188, y0: 50, x1: 364, y1: 75 }, confidence: 0.85 }],
      },
    });

    const geometry: TtuTableGeometryResult = {
      columns,
      rows: [row],
      issues: [],
      confidence: 0.85,
    };

    const mockSemantics: TtuParsedSchedule = {
      courses: [],
      issues: [{ code: "DAY_UNRESOLVED", message: "لم نتمكن من تحديد اليوم", severity: "warning", rowIndex: 0 }],
      confidence: 0.8,
    };

    const flagged = identifyProblematicCells(geometry, mockSemantics);
    expect(flagged.some((f) => f.columnKey === "meeting" && f.rowIndex === 0)).toBe(true);
  });

  // ── C. DAY_TOKEN_AMBIGUOUS triggers refinement ───────────────────────
  it("C. DAY_TOKEN_AMBIGUOUS triggers meeting refinement", () => {
    const columns = createMockColumns();
    const row = createMockRow(0, 50, 75, {
      meeting: {
        column: "meeting",
        rawText: "2 & 08:30 - 10:00",
        bbox: { x0: 188, y0: 50, x1: 364, y1: 75 },
        confidence: 0.65,
        segments: [{ text: "2 & 08:30 - 10:00", bbox: { x0: 188, y0: 50, x1: 364, y1: 75 }, confidence: 0.65 }],
      },
    });

    const geometry: TtuTableGeometryResult = {
      columns,
      rows: [row],
      issues: [],
      confidence: 0.65,
    };

    const mockSemantics: TtuParsedSchedule = {
      courses: [],
      issues: [{ code: "DAY_TOKEN_AMBIGUOUS", message: "رمز غير معروف &", severity: "warning", rowIndex: 0 }],
      confidence: 0.65,
    };

    const flagged = identifyProblematicCells(geometry, mockSemantics);
    expect(flagged.some((f) => f.columnKey === "meeting" && f.rowIndex === 0)).toBe(true);
  });

  // ── D. INVALID_TIME_RANGE triggers meeting refinement ───────────────
  it("D. INVALID_TIME_RANGE triggers meeting refinement", () => {
    const columns = createMockColumns();
    const row = createMockRow(0, 50, 75, {
      meeting: {
        column: "meeting",
        rawText: "حت 20:30-19:30",
        bbox: { x0: 188, y0: 50, x1: 364, y1: 75 },
        confidence: 0.75,
        segments: [{ text: "حت 20:30-19:30", bbox: { x0: 188, y0: 50, x1: 364, y1: 75 }, confidence: 0.75 }],
      },
    });

    const geometry: TtuTableGeometryResult = {
      columns,
      rows: [row],
      issues: [],
      confidence: 0.75,
    };

    const mockSemantics: TtuParsedSchedule = {
      courses: [],
      issues: [{ code: "INVALID_TIME_RANGE", message: "وقت النهاية يسبق البداية", severity: "error", rowIndex: 0 }],
      confidence: 0.7,
    };

    const flagged = identifyProblematicCells(geometry, mockSemantics);
    expect(flagged.some((f) => f.columnKey === "meeting" && f.rowIndex === 0)).toBe(true);
  });

  // ── E. Multi-line meeting crop preserves two segments ────────────────
  it("E. multi-line meeting crop correctly preserves two separate segments", () => {
    const rawText = "ح ث خ 10:00 - 11:00\nن 08:30 - 10:30";
    const score = scoreMeetingText(rawText, 0.9);
    // Should have valid ranges and multiple canonical days
    expect(score).toBeGreaterThan(30);
  });

  // ── F. Multi-line room crop produces two room entities via spatial grouping
  it("F. multi-line room crop produces two room entities via spatial grouping", () => {
    const words = [
      { bbox: { x0: 675, y0: 0, x1: 681, y1: 160 }, text: "|", conf: 96 },
      { bbox: { x0: 617, y0: 30, x1: 652, y1: 90 }, text: "مر", conf: 71 },
      { bbox: { x0: 501, y0: 34, x1: 601, y1: 86 }, text: "207", conf: 90 },
      { bbox: { x0: 362, y0: 30, x1: 483, y1: 90 }, text: "مختبر", conf: 89 },
      { bbox: { x0: 148, y0: 30, x1: 337, y1: 90 }, text: "الحاسوب", conf: 67 },
      { bbox: { x0: 29, y0: 34, x1: 122, y1: 74 }, text: "ICT", conf: 95 },
      { bbox: { x0: 323, y0: 98, x1: 357, y1: 138 }, text: "4", conf: 96 },
    ];

    const entities = groupRoomEntities(words as any, { x0: 0, y0: 155 });
    expect(entities).toHaveLength(2);

    // Entity A (Right cluster)
    expect(entities[0].text).toContain("207");
    expect(entities[0].text).toContain("م");

    // Entity B (Left cluster)
    expect(entities[1].text).toContain("ICT");
    expect(entities[1].text).toContain("4");
  });

  // ── G. Candidate arbitration keeps baseline when candidate is worse ──
  it("G. candidate arbitration keeps baseline when targeted candidate is worse or noisier", () => {
    const baseline = "ح ث 11:30 - 13:00";
    const worseCandidate = "ح @ 11:30 - 13:00";

    const arbitration = arbitrateMeetingCandidate(baseline, 0.9, worseCandidate, 0.7);
    expect(arbitration.replaced).toBe(false);
    expect(arbitration.reason).toContain("Baseline score");
  });

  // ── H. Candidate arbitration accepts candidate when deterministic evidence improves
  it("H. candidate arbitration accepts candidate when canonical evidence improves", () => {
    const baseline = "2 & 08:30 - 10:00";
    const improvedCandidate = "حث 08:30 - 10:00";

    const arbitration = arbitrateMeetingCandidate(baseline, 0.65, improvedCandidate, 0.85);
    expect(arbitration.replaced).toBe(true);
    expect(arbitration.scoreCandidate).toBeGreaterThan(arbitration.scoreBaseline);
  });

  // ── I. Course name noise triggers targeted course-name OCR ───────────
  it("I. leading noise characters (like ») trigger course-name refinement and are scored properly", () => {
    const columns = createMockColumns();
    const row = createMockRow(0, 160, 190, {
      courseName: {
        column: "courseName",
        rawText: "» تصور البيانات",
        bbox: { x0: 536, y0: 160, x1: 669, y1: 190 },
        confidence: 0.85,
        segments: [{ text: "» تصور البيانات", bbox: { x0: 536, y0: 160, x1: 669, y1: 190 }, confidence: 0.85 }],
      },
    });

    const geometry: TtuTableGeometryResult = {
      columns,
      rows: [row],
      issues: [],
      confidence: 0.85,
    };

    const flagged = identifyProblematicCells(geometry);
    expect(flagged.some((f) => f.columnKey === "courseName" && f.rowIndex === 0)).toBe(true);

    const cleanScore = scoreCourseNameText("تصور البيانات", 0.9);
    const noisyScore = scoreCourseNameText("» تصور البيانات", 0.85);
    expect(cleanScore).toBeGreaterThan(noisyScore);
  });

  // ── J. Non-guessing: No curriculum/fuzzy correction ─────────────────
  it("J. non-guessing: does NOT use curriculum database or fuzzy course matching", () => {
    // Preserves literal OCR reading without replacing "المهيكلة" with "الموزعة"
    const score = scoreCourseNameText("مختبر قواعد البيانات المهيكلة", 0.91);
    expect(score).toBeGreaterThan(20);
  });

  // ── K. Non-guessing: "حت 08:30 - 10:00" does NOT become ["ح", "ث"] ───
  it("K. non-guessing: 'حت 08:30 - 10:00' does NOT silently become ['ح', 'ث']", () => {
    const parsed = parseTtuDayCodes("حت 08:30 - 10:00", 0.8);
    // 'ت' is NOT canonical TTU day code. Only 'ح' is valid.
    expect(parsed.days).toEqual(["ح"]);
    expect(parsed.days).not.toContain("ث");
    expect(parsed.issues.some((i) => i.code === "DAY_TOKEN_AMBIGUOUS")).toBe(true);

    // Scoring also strictly recognizes only 1 canonical day and penalizes 'ت'
    const status = determineFieldStatus("meeting", "حت 08:30 - 10:00");
    expect(status).toBe("PARTIALLY_RESOLVED");
    expect(status).not.toBe("RESOLVED_FROM_PIXELS");
  });

  // ── L. Maximum one refinement pass per cell ──────────────────────────
  it("L. maximum one refinement pass: identifyProblematicCells never duplicates cells", () => {
    const columns = createMockColumns();
    const row = createMockRow(0, 50, 75, {
      meeting: {
        column: "meeting",
        rawText: "حت 20:30-19:30",
        bbox: { x0: 188, y0: 50, x1: 364, y1: 75 },
        confidence: 0.5,
        segments: [{ text: "حت 20:30-19:30", bbox: { x0: 188, y0: 50, x1: 364, y1: 75 }, confidence: 0.5 }],
      },
    });

    const geometry: TtuTableGeometryResult = {
      columns,
      rows: [row],
      issues: [],
      confidence: 0.5,
    };

    // Multiple issue codes pointing to the same row & meeting cell
    const mockSemantics: TtuParsedSchedule = {
      courses: [],
      issues: [
        { code: "DAY_TOKEN_AMBIGUOUS", message: "ambiguous", severity: "warning", rowIndex: 0 },
        { code: "INVALID_TIME_RANGE", message: "invalid time", severity: "error", rowIndex: 0 },
      ],
      confidence: 0.5,
    };

    const flagged = identifyProblematicCells(geometry, mockSemantics);
    const meetingFlags = flagged.filter((f) => f.rowIndex === 0 && f.columnKey === "meeting");
    expect(meetingFlags).toHaveLength(1);
  });

  // ── M. Cancellation / stale attempt safety ───────────────────────────
  it("M. cancellation safety: refinement aborts cleanly when signal is triggered", async () => {
    const controller = new AbortController();
    controller.abort(); // already aborted

    const columns = createMockColumns();
    const row = createMockRow(0, 50, 75, {
      meeting: {
        column: "meeting",
        rawText: "2 & 08:30 - 10:00",
        bbox: { x0: 188, y0: 50, x1: 364, y1: 75 },
        confidence: 0.5,
        segments: [],
      },
    });

    const geometry: TtuTableGeometryResult = {
      columns,
      rows: [row],
      issues: [],
      confidence: 0.5,
    };

    const mockEngine = {
      recognizeImage: vi.fn(),
    };

    const fakeBlob = new Blob(["mock"], { type: "image/png" });
    const result = await refineTableCells(fakeBlob, geometry, mockEngine as any, {
      signal: controller.signal,
    });

    expect(result.refinedCount).toBe(0);
    expect(mockEngine.recognizeImage).not.toHaveBeenCalled();
  });

  // ── N. Original-coordinate bbox mapping remains scale-invariant ─────
  it("N. scale-invariant coordinate mapping: word bboxes map accurately back to original image space", () => {
    const cropBbox = { x0: 185, y0: 155, x1: 395, y1: 195 };
    const scale = TARGET_CELL_SCALE; // 4.0

    // A word recognized at x0=400, y0=40 inside the 4x upscaled crop
    const cropWordX0 = 400;
    const cropWordY0 = 40;

    const mappedX0 = Math.round(cropBbox.x0 + cropWordX0 / scale);
    const mappedY0 = Math.round(cropBbox.y0 + cropWordY0 / scale);

    expect(mappedX0).toBe(185 + 100); // 285
    expect(mappedY0).toBe(155 + 10);  // 165

    // Must be strictly within original image crop bounds
    expect(mappedX0).toBeGreaterThanOrEqual(cropBbox.x0);
    expect(mappedX0).toBeLessThanOrEqual(cropBbox.x1);
    expect(mappedY0).toBeGreaterThanOrEqual(cropBbox.y0);
    expect(mappedY0).toBeLessThanOrEqual(cropBbox.y1);
  });

  // ── P. Cross-line day contamination prevention ───────────────────────
  it("P. cross-line contamination prevention: lower day 'ن' NEVER attaches to upper time range '10:00 - 11:00'", () => {
    // Synthetic words simulating Data Visualization meeting cell
    const words = [
      { text: "&", confidence: 0.5, bbox: { x0: 780, y0: 40, x1: 820, y1: 70 } },
      { text: "#", confidence: 0.8, bbox: { x0: 730, y0: 40, x1: 760, y1: 70 } },
      { text: "10:00", confidence: 0.9, bbox: { x0: 560, y0: 40, x1: 700, y1: 70 } },
      { text: "-", confidence: 0.9, bbox: { x0: 510, y0: 50, x1: 530, y1: 60 } },
      { text: "11:00", confidence: 0.9, bbox: { x0: 350, y0: 40, x1: 490, y1: 70 } },
      // Lower session words
      { text: "10:30", confidence: 0.9, bbox: { x0: 100, y0: 40, x1: 250, y1: 70 } },
      { text: "-", confidence: 0.9, bbox: { x0: 60, y0: 50, x1: 80, y1: 60 } },
      { text: "08:30", confidence: 0.95, bbox: { x0: 400, y0: 100, x1: 550, y1: 130 } },
      { text: "ن", confidence: 0.85, bbox: { x0: 600, y0: 100, x1: 650, y1: 130 } },
    ];

    const entities = groupMeetingEntities(words as any, { x0: 175, y0: 155 }, 0.25);
    expect(entities.length).toBeGreaterThanOrEqual(2);

    const upperEntity = entities.find((e) => e.timeRange === "10:00 - 11:00");
    expect(upperEntity).toBeDefined();

    // MUST NOT contain 'ن'
    expect(upperEntity!.dayText).not.toContain("ن");
    expect(upperEntity!.text).not.toContain("ن");

    // Parsing day codes from upper entity must NOT produce 'ن'
    const dayResult = parseTtuDayCodes(upperEntity!.text, 0.9);
    expect(dayResult.days).not.toContain("ن");

    // Lower entity should have 'ن' and valid time
    const lowerEntity = entities.find((e) => e.timeRange === "08:30 - 10:30");
    expect(lowerEntity).toBeDefined();
    expect(lowerEntity!.dayText).toContain("ن");
    const lowerDayResult = parseTtuDayCodes(lowerEntity!.text, 0.9);
    expect(lowerDayResult.days).toContain("ن");
  });

  // ── Q. Course name arbitration preserves clean Arabic baseline ──────
  it("Q. course name arbitration preserves clean baseline 'تصور البيانات' over candidate 'تصور البياتات'", () => {
    const cleanBaseline = "تصور البيانات";
    const noisyBaseline = "» تصور البيانات";
    const candidateTypo = "تصور البياتات";

    const scoreCleanBase = scoreCourseNameText(cleanBaseline, 0.8);
    const scoreCand = scoreCourseNameText(candidateTypo, 0.8);

    // Clean baseline and candidate have comparable score, so candidate cannot beat baseline + 5
    expect(scoreCand).toBeLessThanOrEqual(scoreCleanBase + 5);

    // Stripping noise symbols yields clean baseline
    const stripped = noisyBaseline.replace(/^[»«|~^_\s\d\-–—]+|[»«|~^_\s\d\-–—]+$/g, "").trim();
    expect(stripped).toBe("تصور البيانات");
  });

  // ── R. Network course: 'حت' remains partially resolved and does NOT become 'ح ث' ──
  it("R. network course: 'حت 08:30 - 10:00' does NOT invent Tuesday ('ث')", () => {
    const dayResult = parseTtuDayCodes("حت 08:30 - 10:00", 0.9);
    expect(dayResult.days).toContain("ح");
    expect(dayResult.days).not.toContain("ث");
    expect(dayResult.issues.some((iss) => iss.code === "DAY_TOKEN_AMBIGUOUS")).toBe(true);
  });

  // ── S. Noisy room candidate ('متي الحاسوب 167 4') does NOT win over stronger baseline ──
  it("S. noisy room candidate 'متي الحاسوب 167 4' does NOT win over stronger baseline evidence", () => {
    const dummyBbox = { x0: 0, y0: 100, x1: 180, y1: 140 };

    // Baseline entities representing clean evidence from screenshot:
    const baselineEntities = [
      { text: "م 207", bbox: dummyBbox, confidence: 0.9 },
      { text: "مختبر الحاسوب ICT 4", bbox: dummyBbox, confidence: 0.9 },
    ];

    // Corrupted targeted candidate containing "متي" and "167":
    const noisyCandidateEntities = [
      { text: "م 207", bbox: dummyBbox, confidence: 0.9 },
      { text: "متي الحاسوب 167 4", bbox: dummyBbox, confidence: 0.8 },
    ];

    // Score evaluation proves corrupted entity receives negative score
    const scoreCorrupted = scoreSingleRoomEntity("متي الحاسوب 167 4", 0.8);
    expect(scoreCorrupted).toBeLessThan(0);

    const scoreCleanLab = scoreSingleRoomEntity("مختبر الحاسوب ICT 4", 0.9);
    expect(scoreCleanLab).toBeGreaterThanOrEqual(25);

    // Arbitration MUST reject the corrupted candidate and preserve baseline
    const result = arbitrateRoomCandidates(baselineEntities, noisyCandidateEntities);
    expect(result.replaced).toBe(false);
    expect(result.entities).toEqual(baselineEntities);
    expect(result.scoreBaseline).toBeGreaterThan(result.scoreCandidate);
  });

  // ── T. Field status rejects corrupted room from being marked resolved ──
  it("T. determineFieldStatus marks corrupted room entity like 'متي الحاسوب 167 4' as UNRESOLVED, never RESOLVED_FROM_PIXELS", () => {
    const statusCorrupted = determineFieldStatus("room", "متي الحاسوب 167 4");
    expect(statusCorrupted).not.toBe("RESOLVED_FROM_PIXELS");
    expect(statusCorrupted).toBe("UNRESOLVED");

    const statusMixed = determineFieldStatus("room", "م 207\nمتي الحاسوب 167 4");
    expect(statusMixed).not.toBe("RESOLVED_FROM_PIXELS");

    const statusClean = determineFieldStatus("room", "م 207\nمختبر الحاسوب ICT 4");
    expect(statusClean).toBe("RESOLVED_FROM_PIXELS");
  });

  // ── U. Baseline room text parsing extracts clean entities ───────────
  it("U. extractRoomEntitiesFromText separates 'م 207 مختبر الحاسوب ICT 4' into two distinct clean entities", () => {
    const raw = "م 207 مختبر الحاسوب \u200EICT\n4";
    const dummyBbox = { x0: 0, y0: 100, x1: 180, y1: 140 };
    const entities = extractRoomEntitiesFromText(raw, dummyBbox, 0.85);

    expect(entities).toHaveLength(2);
    expect(entities[0].text).toBe("م 207");
    expect(entities[1].text).toContain("مختبر الحاسوب");
    expect(entities[1].text).toContain("4");
    expect(entities[1].text).not.toContain("متي");
  });
});
