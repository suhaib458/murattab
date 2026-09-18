import type { ClassSession, Course, DayCode, RoomLocation } from "./models";
import { generateId } from "@/lib/uuid";

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
    id: generateId(),
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

/** Map JS Date.getDay() (0=Sun…6=Sat) to the Arabic DayCode used by Murattab. Friday (5) returns null. */
export function getDayCodeFromJsDay(jsDay: number): DayCode | null {
  const map: Record<number, DayCode> = { 6: "س", 0: "ح", 1: "ن", 2: "ث", 3: "ر", 4: "خ" };
  return map[jsDay] ?? null;
}

/**
 * Clean, natural Arabic duration formatting for UI messaging.
 * Examples:
 * - 1 min -> "دقيقة"
 * - 8 min -> "8 دقائق"
 * - 45 min -> "45 دقيقة"
 * - 60 min -> "ساعة"
 * - 75 min -> "ساعة و15 دقيقة"
 * - 120 min -> "ساعتان"
 * - 150 min -> "ساعتان و30 دقيقة"
 */
export function formatArabicDuration(minutes: number): string {
  if (minutes <= 0) return "أقل من دقيقة";
  if (minutes === 1) return "دقيقة";
  if (minutes === 2) return "دقيقتان";
  if (minutes >= 3 && minutes <= 10) return `${minutes} دقائق`;
  if (minutes < 60) return `${minutes} دقيقة`;

  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;

  let hourText: string;
  if (hours === 1) hourText = "ساعة";
  else if (hours === 2) hourText = "ساعتان";
  else if (hours >= 3 && hours <= 10) hourText = `${hours} ساعات`;
  else hourText = `${hours} ساعة`;

  if (rem === 0) return hourText;

  let remText: string;
  if (rem === 1) remText = "دقيقة";
  else if (rem === 2) remText = "دقيقتان";
  else if (rem >= 3 && rem <= 10) remText = `${rem} دقائق`;
  else remText = `${rem} دقيقة`;

  return `${hourText} و${remText}`;
}

export function getCurrentSession(sessions: ClassSession[], nowTime: string): ClassSession | null {
  return sessions.find((s) => s.startsAt <= nowTime && s.endsAt > nowTime) ?? null;
}

export function getUpcomingSession(sessions: ClassSession[], nowTime: string): ClassSession | null {
  const sorted = sortSessions(sessions);
  return sorted.find((s) => s.startsAt > nowTime) ?? null;
}

export function getMinutesRemainingInSession(session: ClassSession, nowTime: string): number {
  return Math.max(0, timeToMinutes(session.endsAt) - timeToMinutes(nowTime));
}

export function getMinutesUntilSession(session: ClassSession, nowTime: string): number {
  return Math.max(0, timeToMinutes(session.startsAt) - timeToMinutes(nowTime));
}

export interface NextScheduledSession {
  session: ClassSession;
  dayCode: DayCode;
  dayName: string;
  daysAhead: number;
}

/**
 * Finds the next scheduled session after the current moment, searching forward across the teaching week.
 * Skips Friday (weekend) and searches up to one full weekly cycle (7 days ahead).
 * Returns null if the student has no sessions scheduled.
 */
export function getNextScheduledSession(
  allSessions: ClassSession[],
  currentJsDay: number,
  nowTime: string
): NextScheduledSession | null {
  if (allSessions.length === 0) return null;

  // 1. Check today if it's a teaching day
  if (currentJsDay !== 5) {
    const todayCode = getDayCodeFromJsDay(currentJsDay);
    if (todayCode) {
      const todayUpcoming = sortSessions(allSessions.filter((s) => s.day === todayCode && s.startsAt > nowTime));
      if (todayUpcoming.length > 0) {
        return {
          session: todayUpcoming[0],
          dayCode: todayCode,
          dayName: dayNames[todayCode],
          daysAhead: 0
        };
      }
    }
  }

  // 2. Check future days in weekly cycle (up to 7 days ahead)
  for (let offset = 1; offset <= 7; offset++) {
    const nextJsDay = (currentJsDay + offset) % 7;
    if (nextJsDay === 5) continue; // Skip Friday
    const nextCode = getDayCodeFromJsDay(nextJsDay);
    if (!nextCode) continue;

    const daySessions = sortSessions(allSessions.filter((s) => s.day === nextCode));
    if (daySessions.length > 0) {
      return {
        session: daySessions[0],
        dayCode: nextCode,
        dayName: dayNames[nextCode],
        daysAhead: offset
      };
    }
  }

  return null;
}

export type FreeTimeIntelligence =
  | { status: "current"; currentSlot: FreeTimeSlot; minutesRemaining: number }
  | { status: "upcoming"; nextSlot: FreeTimeSlot; minutesUntil: number }
  | { status: "none" };

export function getFreeTimeIntelligence(todaySessions: ClassSession[], nowTime: string): FreeTimeIntelligence {
  const slots = calculateFreeTimeSlots(todaySessions);
  if (slots.length === 0) return { status: "none" };

  const currentSlot = slots.find((slot) => slot.startsAt <= nowTime && slot.endsAt > nowTime);
  if (currentSlot) {
    const minutesRemaining = Math.max(0, timeToMinutes(currentSlot.endsAt) - timeToMinutes(nowTime));
    return { status: "current", currentSlot, minutesRemaining };
  }

  const nextSlot = slots.find((slot) => slot.startsAt > nowTime);
  if (nextSlot) {
    const minutesUntil = Math.max(0, timeToMinutes(nextSlot.startsAt) - timeToMinutes(nowTime));
    return { status: "upcoming", nextSlot, minutesUntil };
  }

  return { status: "none" };
}

/**
 * Determine which day tab to auto-select when the Schedule page opens.
 *
 * Rules:
 * 1. If today is a teaching day (Sat–Thu) and has sessions → select today.
 * 2. If today is a teaching day with no sessions, or today is Friday →
 *    search forward through the weekly cycle for the nearest teaching day
 *    that has at least one session.
 * 3. If the entire schedule is empty → fallback to Saturday ("س"), the first
 *    item in orderedDays.
 */
export function getInitialScheduleDay(
  allSessions: ClassSession[],
  currentJsDay: number
): DayCode {
  // Saturday through Thursday: ALWAYS select today's teaching day initially
  if (currentJsDay !== 5) {
    const todayCode = getDayCodeFromJsDay(currentJsDay);
    if (todayCode) {
      return todayCode;
    }
  }

  // Friday only: search forward for nearest teaching day that actually has sessions
  const daysWithSessions = new Set(allSessions.map((s) => s.day));
  for (let offset = 1; offset <= 6; offset++) {
    const nextJsDay = (5 + offset) % 7;
    if (nextJsDay === 5) continue;
    const nextCode = getDayCodeFromJsDay(nextJsDay);
    if (nextCode && daysWithSessions.has(nextCode)) {
      return nextCode;
    }
  }

  // Friday + completely empty schedule → fallback to Saturday
  return "س";
}

export interface DayConflictAnalysis {
  /** Set of session IDs that are involved in at least one conflict. */
  conflictingSessionIds: Set<string>;
  /** Number of unique conflict pairs (A↔B counted once, not twice). */
  conflictPairCount: number;
}

/**
 * Analyze conflicts within a single day's session list.
 *
 * Uses `findConflicts(sessions, sessions)` internally but deduplicates the
 * directional pairs: if A overlaps B, findConflicts returns both A→B and B→A,
 * but this helper normalizes them into a single unique pair by sorting IDs.
 */
export function analyzeDayConflicts(sessions: ClassSession[]): DayConflictAnalysis {
  if (sessions.length < 2) {
    return { conflictingSessionIds: new Set(), conflictPairCount: 0 };
  }

  const rawConflicts = findConflicts(sessions, sessions);
  const seenPairs = new Set<string>();
  const conflictingSessionIds = new Set<string>();

  for (const conflict of rawConflicts) {
    // Normalize pair key so A↔B and B↔A produce the same key
    const pairKey =
      conflict.candidate.id < conflict.other.id
        ? `${conflict.candidate.id}|${conflict.other.id}`
        : `${conflict.other.id}|${conflict.candidate.id}`;

    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey);
      conflictingSessionIds.add(conflict.candidate.id);
      conflictingSessionIds.add(conflict.other.id);
    }
  }

  return { conflictingSessionIds, conflictPairCount: seenPairs.size };
}
