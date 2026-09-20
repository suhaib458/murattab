/**
 * Murattab TTU Schedule Segment Pairer.
 *
 * Deterministically pairs meeting segments with room segments within a single course row
 * using vertical bounding box geometry.
 *
 * Rules:
 * - Multi-session courses (e.g. lecture + lab) pair meeting[i] to room[i] based on vertical proximity.
 * - Never blindly duplicates a single room across different meeting segments.
 * - Emits SEGMENT_PAIRING_AMBIGUOUS when vertical alignment is indeterminate.
 * - Emits EXTRA_ROOM_SEGMENT or EXTRA_MEETING_SEGMENT when counts diverge.
 */

import type { OcrBoundingBox } from "@/domain/ocr/types";
import type { TtuCellSegment } from "@/domain/ttu-table/types";
import type { TtuSemanticIssue } from "./types";

export interface PairedSegment {
  meetingSegment: TtuCellSegment;
  roomSegment?: TtuCellSegment;
  pairingConfidence: number;
}

export interface SegmentPairingResult {
  pairs: PairedSegment[];
  issues: TtuSemanticIssue[];
}

function yCenter(bbox: OcrBoundingBox): number {
  return (bbox.y0 + bbox.y1) / 2;
}

/**
 * Pairs meeting segments with room segments for a table row.
 *
 * @param meetingSegments - Visual line segments in the meeting cell
 * @param roomSegments - Visual line segments in the room cell
 * @param rowBbox - Bounding box of the enclosing row
 * @param rowConfidence - Overall row confidence from geometry
 * @param courseName - Optional course name for diagnostics
 */
export function pairMeetingAndRoomSegments(
  meetingSegments: TtuCellSegment[],
  roomSegments: TtuCellSegment[],
  rowBbox: OcrBoundingBox,
  rowConfidence = 1.0,
  courseName?: string
): SegmentPairingResult {
  const issues: TtuSemanticIssue[] = [];
  const pairs: PairedSegment[] = [];

  const rowHeight = Math.max(1, rowBbox.y1 - rowBbox.y0);

  // If no meeting segments exist
  if (meetingSegments.length === 0) {
    if (roomSegments.length > 0) {
      issues.push({
        code: "EXTRA_ROOM_SEGMENT",
        message: `تم العثور على قاعة دون وجود موعد أو وقت للمحاضرة${courseName ? ` لمادة "${courseName}"` : ""}.`,
        severity: "info",
        courseName
      });
    }
    return { pairs: [], issues };
  }

  // If exactly 1 meeting segment
  if (meetingSegments.length === 1) {
    const meeting = meetingSegments[0];
    if (roomSegments.length === 0) {
      pairs.push({
        meetingSegment: meeting,
        roomSegment: undefined,
        pairingConfidence: Math.min(rowConfidence, meeting.confidence)
      });
    } else {
      const room = roomSegments[0];
      const dist = Math.abs(yCenter(meeting.bbox) - yCenter(room.bbox)) / rowHeight;
      const confidence = Math.min(rowConfidence, meeting.confidence, room.confidence, Math.max(0.5, 1.0 - dist * 0.5));
      pairs.push({
        meetingSegment: meeting,
        roomSegment: room,
        pairingConfidence: confidence
      });

      if (roomSegments.length > 1) {
        issues.push({
          code: "EXTRA_ROOM_SEGMENT",
          message: `يوجد قاعات إضافية لم تقترن بأي موعد${courseName ? ` لمادة "${courseName}"` : ""}.`,
          severity: "info",
          courseName
        });
      }
    }
    return { pairs, issues };
  }

  // Multi-session course row: meetingSegments.length >= 2
  // Sort both arrays top-to-bottom by yCenter
  const sortedMeetings = [...meetingSegments].sort((a, b) => yCenter(a.bbox) - yCenter(b.bbox));
  const sortedRooms = [...roomSegments].sort((a, b) => yCenter(a.bbox) - yCenter(b.bbox));

  // Case A: Equal segment counts (e.g. 2 meetings ↔ 2 rooms)
  if (sortedMeetings.length === sortedRooms.length) {
    for (let i = 0; i < sortedMeetings.length; i++) {
      const meeting = sortedMeetings[i];
      const room = sortedRooms[i];
      const dist = Math.abs(yCenter(meeting.bbox) - yCenter(room.bbox)) / rowHeight;
      const pairingConf = Math.min(
        rowConfidence,
        meeting.confidence,
        room.confidence,
        Math.max(0.5, 1.0 - dist * 0.5)
      );
      pairs.push({
        meetingSegment: meeting,
        roomSegment: room,
        pairingConfidence: pairingConf
      });
    }
    return { pairs, issues };
  }

  // Case B: Fewer rooms than meetings (e.g. 2 meetings and 1 room)
  if (sortedRooms.length < sortedMeetings.length) {
    if (sortedRooms.length === 0) {
      for (const meeting of sortedMeetings) {
        pairs.push({
          meetingSegment: meeting,
          roomSegment: undefined,
          pairingConfidence: Math.min(rowConfidence, meeting.confidence)
        });
      }
      return { pairs, issues };
    }

    // Attempt closest vertical alignment
    // For each room, find the meeting segment with the lowest vertical distance
    const usedRoomIndices = new Set<number>();

    for (const meeting of sortedMeetings) {
      const meetingCenter = yCenter(meeting.bbox);
      let bestRoomIdx = -1;
      let bestDist = Infinity;

      for (let r = 0; r < sortedRooms.length; r++) {
        if (usedRoomIndices.has(r)) continue;
        const roomCenter = yCenter(sortedRooms[r].bbox);
        const dist = Math.abs(meetingCenter - roomCenter) / rowHeight;
        if (dist < bestDist) {
          bestDist = dist;
          bestRoomIdx = r;
        }
      }

      // Strong alignment requirement: normalized distance must be under 0.30 of row height
      if (bestRoomIdx !== -1 && bestDist <= 0.30) {
        usedRoomIndices.add(bestRoomIdx);
        const room = sortedRooms[bestRoomIdx];
        pairs.push({
          meetingSegment: meeting,
          roomSegment: room,
          pairingConfidence: Math.min(rowConfidence, meeting.confidence, room.confidence, 1.0 - bestDist * 0.5)
        });
      } else {
        // Room not strongly aligned or ambiguous
        pairs.push({
          meetingSegment: meeting,
          roomSegment: undefined,
          pairingConfidence: Math.min(rowConfidence, meeting.confidence)
        });
      }
    }

    // If there were rooms that couldn't be paired unambiguously
    if (usedRoomIndices.size < sortedRooms.length) {
      issues.push({
        code: "SEGMENT_PAIRING_AMBIGUOUS",
        message: `تعذر مطابقة القاعة بالموعد بدقة هندسية مؤكدة${courseName ? ` لمادة "${courseName}"` : ""}.`,
        severity: "warning",
        courseName
      });
    }

    return { pairs, issues };
  }

  // Case C: More rooms than meetings
  // Pair each meeting with its closest room
  const usedRoomIndices = new Set<number>();
  for (const meeting of sortedMeetings) {
    const meetingCenter = yCenter(meeting.bbox);
    let bestRoomIdx = -1;
    let bestDist = Infinity;

    for (let r = 0; r < sortedRooms.length; r++) {
      if (usedRoomIndices.has(r)) continue;
      const dist = Math.abs(meetingCenter - yCenter(sortedRooms[r].bbox)) / rowHeight;
      if (dist < bestDist) {
        bestDist = dist;
        bestRoomIdx = r;
      }
    }

    if (bestRoomIdx !== -1 && bestDist <= 0.35) {
      usedRoomIndices.add(bestRoomIdx);
      const room = sortedRooms[bestRoomIdx];
      pairs.push({
        meetingSegment: meeting,
        roomSegment: room,
        pairingConfidence: Math.min(rowConfidence, meeting.confidence, room.confidence, 1.0 - bestDist * 0.5)
      });
    } else {
      pairs.push({
        meetingSegment: meeting,
        roomSegment: undefined,
        pairingConfidence: Math.min(rowConfidence, meeting.confidence)
      });
    }
  }

  issues.push({
    code: "EXTRA_ROOM_SEGMENT",
    message: `يوجد قاعات إضافية لم تقترن بأي موعد${courseName ? ` لمادة "${courseName}"` : ""}.`,
    severity: "info",
    courseName
  });

  return { pairs, issues };
}
