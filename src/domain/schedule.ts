import type { ClassSession, Course, DayCode, RoomLocation } from "./models";

export const orderedDays: DayCode[] = ["س", "ح", "ن", "ث", "ر", "خ"];
export const dayNames: Record<DayCode, string> = { س: "السبت", ح: "الأحد", ن: "الاثنين", ث: "الثلاثاء", ر: "الأربعاء", خ: "الخميس" };

export function formatArabicTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const period = h < 12 ? "ص" : "م";
  const hour = h % 12 || 12;
  return `${hour}:${m.toString().padStart(2, "0")} ${period}`;
}

export function parseDayCodes(raw: string): DayCode[] {
  return [...new Set([...raw].filter((code): code is DayCode => orderedDays.includes(code as DayCode)))];
}

/**
 * @deprecated Heuristic only. The 100/200/300 floor convention is NOT
 * officially documented by TTU (Phase 3B / docs/ttu-data-sources.md:
 * `UNVERIFIED_HEURISTIC`). The function is retained for backward
 * compatibility with V0 callers and tests but MUST NOT be used in
 * production UI flows. Do not surface floor labels to end users.
 */
export function getFloorLabel(roomDigits: string): string | null {
  const num = parseInt(roomDigits, 10);
  if (isNaN(num)) return null;
  if (num >= 100 && num < 200) return "الطابق الأول";
  if (num >= 200 && num < 300) return "الطابق الثاني";
  if (num >= 300 && num < 400) return "الطابق الثالث";
  return null;
}

export function expandRoom(raw: string, columnContext = true): RoomLocation {
  const clean = raw.trim();
  if (!clean) return { raw: "", label: "غير محدد", isOnline: false };
  if (/^online$/i.test(clean) || clean === "عبر الإنترنت" || clean === "أونلاين") {
    return { raw: clean, label: "عبر الإنترنت", isOnline: true };
  }

  if (columnContext) {
    let buildingName: string | null = null;
    const digitsMatch = clean.match(/\d+/);

    const hasEngineering = /(?:^|\s|\d)(?:هـ|ه)(?:\s|\d|$)/.test(clean);
    const hasBusiness = /(?:^|\s|\d)ع(?:\s|\d|$)/.test(clean);
    const hasHallComplex = /(?:^|\s|\d)م(?:\s|\d|$)/.test(clean);

    if (hasEngineering) {
      buildingName = "كلية الهندسة";
    } else if (hasBusiness) {
      buildingName = "كلية الأعمال";
    } else if (hasHallComplex) {
      buildingName = "مجمع القاعات";
    }

    if (buildingName) {
      if (digitsMatch) {
        return { raw: clean, label: `${buildingName} – قاعة ${digitsMatch[0]}`, isOnline: false };
      }
      return { raw: clean, label: buildingName, isOnline: false };
    }
  }

  return { raw: clean, label: clean, isOnline: false };
}

/**
 * Single source of truth for ICT computer-lab display labels.
 *
 * Official TTU lab names take the form "مختبر الحاسوب ICT 1" … "ICT 7"
 * (https://www.ttu.edu.jo/13731/). The schedule raw form is usually
 * "ICT - 4" or "ICT 4"; we preserve the raw token and prefix it with
 * "مختبر الحاسوب " so the UI shows the official lab label.
 *
 * This helper is the ONLY place in the codebase that knows the ICT
 * formatting rule. `normalizer`, the review UI, and the schedule view
 * all delegate here.
 *
 * Returns the labelled string if the room is an ICT lab, otherwise null.
 */
export function getIctLabLabel(roomRaw: string, kind: ClassSession["kind"] | "unspecified" | undefined): string | null {
  if (kind !== "lab") return null;
  const clean = roomRaw.trim();
  if (!clean) return null;
  if (/(?:^|\s)ICT(?:\s*-\s*\d+|\s+\d+|$)/i.test(clean)) {
    return `مختبر الحاسوب ${clean}`;
  }
  return null;
}

export function sortSessions(sessions: ClassSession[]): ClassSession[] {
  return [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function hasConflict(candidate: ClassSession, existing: ClassSession[], ignoreCourseId?: string): boolean {
  return existing.some(
    (other) =>
      other.id !== candidate.id &&
      (!ignoreCourseId || other.courseId !== ignoreCourseId) &&
      other.day === candidate.day &&
      candidate.startsAt < other.endsAt &&
      candidate.endsAt > other.startsAt
  );
}

export interface ConflictDetail {
  candidate: ClassSession;
  other: ClassSession;
}

export function findConflicts(
  candidates: ClassSession[],
  existing: ClassSession[],
  ignoreCourseId?: string
): ConflictDetail[] {
  const results: ConflictDetail[] = [];
  const pool = ignoreCourseId ? existing.filter((item) => item.courseId !== ignoreCourseId) : existing;
  for (const candidate of candidates) {
    for (const other of pool) {
      if (
        candidate.id !== other.id &&
        candidate.day === other.day &&
        candidate.startsAt < other.endsAt &&
        candidate.endsAt > other.startsAt
      ) {
        results.push({ candidate, other });
      }
    }
  }
  return results;
}

export function makeSessions(input: {
  courseId: string;
  days: DayCode[];
  startsAt: string;
  endsAt: string;
  room: RoomLocation;
  kind: ClassSession["kind"];
}): ClassSession[] {
  return input.days.map((day) => ({
    id: crypto.randomUUID(),
    courseId: input.courseId,
    day,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    room: input.room,
    kind: input.kind
  }));
}

export function courseSessions(course: Course, sessions: ClassSession[]): ClassSession[] {
  return sessions.filter((session) => session.courseId === course.id);
}

export interface FreeTimeSlot {
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function formatDurationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours === 1 && rem === 0) return "ساعة واحدة";
  if (hours === 2 && rem === 0) return "ساعتان";
  if (hours === 1 && rem === 30) return "ساعة ونصف";
  if (rem === 0) return `${hours} ساعات`;
  return `${hours} ساعة و ${rem} دقيقة`;
}

export function calculateFreeTimeSlots(sessions: ClassSession[]): FreeTimeSlot[] {
  const sorted = sortSessions(sessions);
  const slots: FreeTimeSlot[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (next.startsAt > current.endsAt) {
      const dur = timeToMinutes(next.startsAt) - timeToMinutes(current.endsAt);
      if (dur > 0) {
        slots.push({
          startsAt: current.endsAt,
          endsAt: next.startsAt,
          durationMinutes: dur
        });
      }
    }
  }
  return slots;
}

