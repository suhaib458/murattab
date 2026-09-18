"use client";

import type { ClassSession, Course, DayCode } from "@/domain/models";
import {
  analyzeDayConflicts,
  calculateFreeTimeSlots,
  formatArabicDuration,
  formatArabicTime,
  formatDurationMinutes,
  getCurrentSession,
  getMinutesRemainingInSession,
  getMinutesUntilSession,
  getUpcomingSession,
  sortSessions,
  timeToMinutes
} from "@/domain/schedule";

export function ScheduleSessionList({
  sessions,
  courses,
  day,
  todayCode,
  nowTime,
  empty
}: {
  sessions: ClassSession[];
  courses: Course[];
  day: DayCode;
  todayCode: DayCode | null;
  nowTime: string;
  empty: string;
}) {
  const sorted = sortSessions(sessions);
  const isToday = day === todayCode;

  // Current/upcoming detection (only for today)
  const currentSession = isToday ? getCurrentSession(sorted, nowTime) : null;
  const upcomingSession = isToday ? getUpcomingSession(sorted, nowTime) : null;

  // Conflict detection
  const conflicts = analyzeDayConflicts(sorted);

  // Free-time gaps between sessions
  const freeSlots = calculateFreeTimeSlots(sorted);
  const totalFreeMinutes = freeSlots.reduce((sum, slot) => sum + slot.durationMinutes, 0);

  if (!sorted.length) return <div className="card empty">{empty}</div>;

  // Build a map of gap-after for each session (keyed by session index)
  const gapAfter = new Map<number, { startsAt: string; endsAt: string; durationMinutes: number }>();
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (next.startsAt > current.endsAt) {
      const dur = timeToMinutes(next.startsAt) - timeToMinutes(current.endsAt);
      if (dur > 0) {
        gapAfter.set(i, {
          startsAt: current.endsAt,
          endsAt: next.startsAt,
          durationMinutes: dur
        });
      }
    }
  }

  return (
    <>
      {/* Day summary strip */}
      <div className="schedule-day-summary" aria-label="ملخص اليوم">
        <span>{sorted.length === 1 ? "محاضرة واحدة" : sorted.length === 2 ? "محاضرتان" : `${sorted.length} محاضرات`}</span>
        <span className="schedule-day-summary-sep" aria-hidden="true">·</span>
        <span>{formatArabicTime(sorted[0].startsAt)} — {formatArabicTime(sorted[sorted.length - 1].endsAt)}</span>
        {totalFreeMinutes > 0 && (
          <>
            <span className="schedule-day-summary-sep" aria-hidden="true">·</span>
            <span>فراغ {formatArabicDuration(totalFreeMinutes)}</span>
          </>
        )}
      </div>

      {/* Conflict banner */}
      {conflicts.conflictPairCount > 0 && (
        <div className="conflict-banner" role="status" aria-live="polite">
          ⚠ يوجد {conflicts.conflictPairCount === 1 ? "تعارض" : `${conflicts.conflictPairCount} تعارضات`} في جدول هذا اليوم
        </div>
      )}

      {/* Session cards with gaps */}
      <div style={{ display: "grid", gap: 10 }}>
        {sorted.map((session, idx) => {
          const course = courses.find((item) => item.id === session.courseId);
          const isCurrent = currentSession?.id === session.id;
          const isUpcoming = !isCurrent && upcomingSession?.id === session.id;
          const hasConflict = conflicts.conflictingSessionIds.has(session.id);

          const cardClasses = [
            "session-card",
            isCurrent ? "is-current" : "",
            isUpcoming ? "is-upcoming" : "",
            hasConflict ? "has-conflict" : ""
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div key={session.id}>
              <article className={cardClasses}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className={`kind ${session.kind === "lab" ? "lab" : ""}`}>
                      {session.kind === "lecture" ? "نظري" : session.kind === "lab" ? "عملي" : "غير محدد"}
                    </span>
                    {isCurrent && <span className="session-status-badge current">الآن</span>}
                    {isUpcoming && <span className="session-status-badge upcoming">القادمة</span>}
                    {hasConflict && <span className="session-status-badge conflict">تعارض</span>}
                  </div>
                  <h3>{course?.name ?? "مادة غير معروفة"}</h3>
                  <p className="room-line">{session.room.label}</p>
                  {isCurrent && (
                    <p className="session-remaining muted">
                      متبقي {formatArabicDuration(getMinutesRemainingInSession(session, nowTime))}
                    </p>
                  )}
                  {isUpcoming && (
                    <p className="session-remaining muted">
                      تبدأ بعد {formatArabicDuration(getMinutesUntilSession(session, nowTime))}
                    </p>
                  )}
                </div>
                <div className="time-block">
                  <div className="start">{formatArabicTime(session.startsAt)}</div>
                  <div className="end">— {formatArabicTime(session.endsAt)}</div>
                </div>
              </article>

              {/* Time gap separator */}
              {gapAfter.has(idx) && (() => {
                const gap = gapAfter.get(idx)!;
                return (
                  <div className="time-gap" aria-label={`فراغ ${formatArabicDuration(gap.durationMinutes)}`}>
                    <span className="time-gap-line" aria-hidden="true" />
                    <span className="time-gap-label">
                      فراغ {formatArabicDuration(gap.durationMinutes)}
                    </span>
                    <span className="time-gap-line" aria-hidden="true" />
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </>
  );
}
