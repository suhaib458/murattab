import type { ClassSession, Course, DayCode, RoomLocation } from "./models";

export const orderedDays: DayCode[] = ["س", "ح", "ن", "ث", "ر", "خ"];
export const dayNames: Record<DayCode, string> = { س: "السبت", ح: "الأحد", ن: "الاثنين", ث: "الثلاثاء", ر: "الأربعاء", خ: "الخميس" };
export function formatArabicTime(time: string) { const [h, m] = time.split(":").map(Number); const period = h < 12 ? "ص" : "م"; const hour = h % 12 || 12; return `${hour}:${m.toString().padStart(2, "0")} ${period}`; }
export function parseDayCodes(raw: string): DayCode[] { return [...new Set([...raw].filter((code): code is DayCode => orderedDays.includes(code as DayCode)))]; }
export function expandRoom(raw: string, columnContext = true): RoomLocation { const clean = raw.trim(); if (/^online$/i.test(clean)) return { raw: clean, label: "عبر الإنترنت", isOnline: true }; if (columnContext && clean.includes("م")) { const room = clean.replace("م", "").trim(); return { raw: clean, label: `مجمع القاعات – قاعة ${room}`, isOnline: false }; } return { raw: clean, label: clean, isOnline: false }; }
export function sortSessions(sessions: ClassSession[]) { return [...sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt)); }
export function hasConflict(candidate: ClassSession, existing: ClassSession[]) { return existing.some((other) => other.id !== candidate.id && other.day === candidate.day && candidate.startsAt < other.endsAt && candidate.endsAt > other.startsAt); }
export function makeSessions(input: { courseId: string; days: DayCode[]; startsAt: string; endsAt: string; room: RoomLocation; kind: ClassSession["kind"] }) { return input.days.map((day) => ({ id: crypto.randomUUID(), courseId: input.courseId, day, startsAt: input.startsAt, endsAt: input.endsAt, room: input.room, kind: input.kind })); }
export function courseSessions(course: Course, sessions: ClassSession[]) { return sessions.filter((session) => session.courseId === course.id); }
