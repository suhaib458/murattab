import { describe, expect, it } from "vitest";
import { parseTtuDayCodes } from "@/domain/ttu-schedule-parser/day-parser";
import {
  isVerifiedTtuRoomText,
  parseTtuRoom,
} from "@/domain/ttu-schedule-parser/room-parser";
import {
  arbitrateRoomCandidates,
  groupMeetingEntities,
  scoreMeetingText,
  scoreSingleRoomEntity,
} from "@/features/smart-import/local-cell-refinement";

describe("TTU day and room integrity", () => {
  it("accepts only complete canonical compact day tokens", () => {
    expect(parseTtuDayCodes("حث 11:30 - 13:00").days).toEqual(["ح", "ث"]);
    expect(parseTtuDayCodes("ح ث خ 10:00 - 11:00").days).toEqual(["ح", "ث", "خ"]);
    expect(parseTtuDayCodes("ن ر 11:30 - 13:00").days).toEqual(["ن", "ر"]);
  });

  it("does not extract days from mixed or corrupted tokens", () => {
    const network = parseTtuDayCodes("حت 08:30 - 10:00");
    expect(network.days).toEqual([]);
    expect(network.issues.some((issue) => issue.code === "DAY_TOKEN_AMBIGUOUS")).toBe(true);
    expect(network.issues.some((issue) => issue.code === "DAY_UNRESOLVED")).toBe(true);

    const accidentalArabic = parseTtuDayCodes("نار 11:30 - 13:00");
    expect(accidentalArabic.days).toEqual([]);
    expect(accidentalArabic.issues.some((issue) => issue.code === "DAY_TOKEN_AMBIGUOUS")).toBe(true);
  });

  it("keeps strict day scoring aligned with final semantic parsing", () => {
    const clean = scoreMeetingText("ن ر 11:30 - 13:00", 0.9);
    const corrupted = scoreMeetingText("نار 11:30 - 13:00", 0.9);
    expect(clean).toBeGreaterThan(corrupted);
  });

  it("accepts complete verified TTU room forms", () => {
    const validRooms = [
      "Online",
      "م 207",
      "207 م",
      "DS-ICT 2",
      "قاعة محوسبة 2 DS-ICT",
      "ICT 4",
      "مختبر الحاسوب ICT 4",
      "مختبر الحاسوب 5 ICT",
    ];

    for (const room of validRooms) {
      expect(isVerifiedTtuRoomText(room), room).toBe(true);
      expect(parseTtuRoom(room, 0.9).issues.some((issue) => issue.code === "ROOM_UNRESOLVED"), room).toBe(false);
    }
  });

  it("rejects corrupted room strings even when they contain familiar fragments", () => {
    const corruptedRooms = [
      "مختبر الحاسوب 5 161 ف",
      "acd محوسبة 3 DS-ICT",
      "قاعة محوسبة 3 05-167",
      "متي الحاسوب 167 4",
    ];

    for (const room of corruptedRooms) {
      expect(isVerifiedTtuRoomText(room), room).toBe(false);
      const parsed = parseTtuRoom(room, 0.9);
      expect(parsed.issues.some((issue) => issue.code === "ROOM_UNRESOLVED"), room).toBe(true);
      expect(parsed.confidence, room).toBeLessThanOrEqual(0.35);
      expect(scoreSingleRoomEntity(room, 0.9), room).toBeLessThan(0);
    }
  });

  it("never resurrects a rejected room candidate when baseline is empty", () => {
    const bbox = { x0: 0, y0: 0, x1: 100, y1: 20 };
    const result = arbitrateRoomCandidates(
      [],
      [{ text: "قاعة محوسبة 3 05-167", bbox, confidence: 0.92 }]
    );

    expect(result.replaced).toBe(false);
    expect(result.entities).toEqual([]);
  });

  it("preserves inverted time order instead of silently correcting it", () => {
    const words = [
      { text: "ح", confidence: 0.9, bbox: { x0: 300, y0: 20, x1: 320, y1: 40 } },
      { text: "20:30", confidence: 0.9, bbox: { x0: 210, y0: 20, x1: 280, y1: 40 } },
      { text: "-", confidence: 0.9, bbox: { x0: 190, y0: 20, x1: 200, y1: 40 } },
      { text: "19:30", confidence: 0.9, bbox: { x0: 110, y0: 20, x1: 180, y1: 40 } },
    ];

    const entities = groupMeetingEntities(words, { x0: 0, y0: 0 }, 1);
    expect(entities).toHaveLength(1);
    expect(entities[0].timeRange).toBe("20:30 - 19:30");
    expect(entities[0].text).toContain("20:30 - 19:30");
  });
});
