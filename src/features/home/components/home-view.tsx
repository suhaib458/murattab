"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import {
  calculateFreeTimeSlots,
  dayNames,
  formatArabicDuration,
  formatArabicTime,
  getCurrentSession,
  getDayCodeFromJsDay,
  getFreeTimeIntelligence,
  getMinutesRemainingInSession,
  getMinutesUntilSession,
  getNextScheduledSession,
  getUpcomingSession,
  sortSessions
} from "@/domain/schedule";
import { SessionList } from "@/components/shared/session-list";

export function HomeView({ data }: { data: AppSnapshot }) {
  // Local real-time clock: updates every 30 seconds to refresh active/upcoming state
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const todayJsDay = now.getDay();
  const todayCode = getDayCodeFromJsDay(todayJsDay);
  const todaySessions = todayCode ? sortSessions(data.sessions.filter((s) => s.day === todayCode)) : [];
  const nowTime = now.toTimeString().slice(0, 5);

  // Today session classification
  const currentSession = getCurrentSession(todaySessions, nowTime);
  const upcomingSession = getUpcomingSession(todaySessions, nowTime);
  const activeSession = currentSession ?? upcomingSession;
  const activeCourse = data.courses.find((item) => item.id === activeSession?.courseId);
  const allEnded = todaySessions.length > 0 && !activeSession;
  const hasNoSchedule = data.sessions.length === 0;

  // Next scheduled session across upcoming teaching days (skips Friday, wraps around week)
  const nextScheduled = getNextScheduledSession(data.sessions, todayJsDay, nowTime);
  const nextCourse = nextScheduled ? data.courses.find((c) => c.id === nextScheduled.session.courseId) : null;

  // Daily summary metrics
  const remainingTodaySessions = todaySessions.filter((s) => s.endsAt > nowTime);
  const freeSlots = calculateFreeTimeSlots(todaySessions);
  const totalFreeMinutes = freeSlots.reduce((sum, slot) => sum + slot.durationMinutes, 0);

  // Free-time intelligence
  const freeTimeInfo = getFreeTimeIntelligence(todaySessions, nowTime);

  // Next study day preview (when today is done or has no classes)
  const shouldShowNextDay =
    (todaySessions.length === 0 || allEnded) &&
    nextScheduled !== null &&
    nextScheduled.daysAhead > 0;
  const nextDaySessions = shouldShowNextDay
    ? sortSessions(data.sessions.filter((s) => s.day === nextScheduled.dayCode))
    : [];

  // Rest of today: exclude classes that have completely ended, and exclude current active session
  const restOfTodaySessions = todaySessions.filter(
    (s) => s.endsAt > nowTime && s.id !== currentSession?.id
  );

  return (
    <>
      <section className="hero">
        <div className="next-card" aria-live="polite" data-tour="next-class">
          {hasNoSchedule ? (
            // STATE E — NO SCHEDULE AT ALL
            <>
              <p className="eyebrow">جدولك الدراسي</p>
              <h2>لا توجد مواد مضافة بعد</h2>
              <p className="muted">أضف موادك أو استورد جدولك لتفعيل المساعد اليومي الذكي.</p>
              <div style={{ marginTop: 8 }}>
                <Link className="button primary" href="/schedule">
                  إضافة مادة أو استيراد
                </Link>
              </div>
            </>
          ) : currentSession && activeCourse ? (
            // STATE A — CLASS CURRENTLY RUNNING
            (() => {
              const rem = getMinutesRemainingInSession(currentSession, nowTime);
              const remainingMessage = rem <= 10 ? `تنتهي بعد ${formatArabicDuration(rem)}` : `متبقي ${formatArabicDuration(rem)}`;
              return (
                <>
                  <p className="eyebrow">المحاضرة الحالية</p>
                  <h2>{activeCourse.name}</h2>
                  <div className="row">
                    <div>
                      <div className="label">الوقت</div>
                      <div className="value time">
                        {formatArabicTime(currentSession.startsAt)} — {formatArabicTime(currentSession.endsAt)}
                      </div>
                    </div>
                    <span className={`kind ${currentSession.kind === "lab" ? "lab" : ""}`}>
                      {currentSession.kind === "lecture" ? "نظري" : currentSession.kind === "lab" ? "عملي" : "غير محدد"}
                    </span>
                  </div>
                  <p className="muted">القاعة: {currentSession.room.label}</p>
                  <span className="hero-status-pill">{remainingMessage}</span>
                </>
              );
            })()
          ) : upcomingSession && activeCourse ? (
            // STATE B — UPCOMING CLASS TODAY
            (() => {
              const until = getMinutesUntilSession(upcomingSession, nowTime);
              const startMessage = `تبدأ بعد ${formatArabicDuration(until)}`;
              return (
                <>
                  <p className="eyebrow">المحاضرة القادمة</p>
                  <h2>{activeCourse.name}</h2>
                  <div className="row">
                    <div>
                      <div className="label">الوقت</div>
                      <div className="value time">
                        {formatArabicTime(upcomingSession.startsAt)} — {formatArabicTime(upcomingSession.endsAt)}
                      </div>
                    </div>
                    <span className={`kind ${upcomingSession.kind === "lab" ? "lab" : ""}`}>
                      {upcomingSession.kind === "lecture" ? "نظري" : upcomingSession.kind === "lab" ? "عملي" : "غير محدد"}
                    </span>
                  </div>
                  <p className="muted">القاعة: {upcomingSession.room.label}</p>
                  <span className="hero-status-pill">{startMessage}</span>
                </>
              );
            })()
          ) : allEnded ? (
            // STATE C — ALL CLASSES FINISHED TODAY
            <>
              <p className="eyebrow">محاضرات اليوم</p>
              <h2>انتهت محاضراتك لليوم</h2>
              {nextScheduled && nextCourse ? (
                <p className="hero-next-preview">
                  القادم: {nextScheduled.dayName} · {nextCourse.name} · {formatArabicTime(nextScheduled.session.startsAt)}
                </p>
              ) : (
                <p className="muted">لقد أتممت جدول هذا اليوم بنجاح.</p>
              )}
            </>
          ) : todayCode ? (
            // STATE D — NO CLASSES TODAY (TEACHING DAY OFF)
            <>
              <p className="eyebrow">محاضرات اليوم · {dayNames[todayCode]}</p>
              <h2>لا توجد محاضرات اليوم</h2>
              {nextScheduled && nextCourse ? (
                <p className="hero-next-preview">
                  محاضرتك القادمة يوم {nextScheduled.dayName} الساعة {formatArabicTime(nextScheduled.session.startsAt)} ({nextCourse.name})
                </p>
              ) : (
                <p className="muted">استمتع بوقت فراغك، أو تفقّد جدول بقية الأسبوع.</p>
              )}
            </>
          ) : (
            // STATE D2 — FRIDAY (WEEKEND)
            <>
              <p className="eyebrow">عطلة نهاية الأسبوع (الجمعة)</p>
              <h2>عطلة نهاية الأسبوع</h2>
              {nextScheduled && nextCourse ? (
                <p className="hero-next-preview">
                  محاضرتك القادمة يوم {nextScheduled.dayName} الساعة {formatArabicTime(nextScheduled.session.startsAt)} ({nextCourse.name})
                </p>
              ) : (
                <p className="muted">لا توجد محاضرات يوم الجمعة.</p>
              )}
            </>
          )}
        </div>
      </section>

      {/* DAILY SUMMARY CHIPS (when today has sessions) */}
      {todaySessions.length > 0 && (
        <section className="daily-summary" aria-label="ملخص اليوم الأكاديمي">
          <div className="daily-summary-item">
            <span className="daily-summary-value">{todaySessions.length} محاضرات</span>
            <span className="daily-summary-label">اليوم</span>
          </div>
          <div className="daily-summary-item">
            <span className="daily-summary-value">
              {remainingTodaySessions.length > 0 ? `${remainingTodaySessions.length} متبقية` : "اكتمل اليوم"}
            </span>
            <span className="daily-summary-label">المتبقي</span>
          </div>
          <div className="daily-summary-item">
            <span className="daily-summary-value">
              {totalFreeMinutes > 0 ? formatArabicDuration(totalFreeMinutes) : "بدون فراغ"}
            </span>
            <span className="daily-summary-label">إجمالي الفراغ</span>
          </div>
        </section>
      )}

      {/* NEXT STUDY DAY PREVIEW (when today is finished or today has no classes) */}
      {shouldShowNextDay && nextCourse && (
        <aside className="next-day-card" aria-label="معاينة اليوم الدراسي التالي">
          <div className="next-day-header">
            <div>
              <p className="eyebrow" style={{ margin: 0, fontSize: "0.78rem" }}>
                {nextScheduled.daysAhead === 1 ? "اليوم التالي (غدًا)" : "اليوم الجامعي القادم"}
              </p>
              <h3>{nextScheduled.dayName}</h3>
            </div>
            <span className="badge subtle">
              {nextDaySessions.length === 1
                ? "محاضرة واحدة"
                : nextDaySessions.length === 2
                  ? "محاضرتان"
                  : `${nextDaySessions.length} محاضرات`}
            </span>
          </div>
          <div className="next-day-details">
            <div>
              <strong>أول محاضرة:</strong> {nextCourse.name} · {formatArabicTime(nextScheduled.session.startsAt)}
            </div>
            <div className="muted">
              القاعة: {nextScheduled.session.room.label} (
              {nextScheduled.session.kind === "lecture"
                ? "نظري"
                : nextScheduled.session.kind === "lab"
                  ? "عملي"
                  : "غير محدد"}
              )
            </div>
          </div>
        </aside>
      )}

      {/* INTELLIGENT FREE TIME CARD */}
      {freeTimeInfo.status === "current" && (
        <aside className="free-time-card current" aria-label="فترة الفراغ الحالية">
          <div className="free-time-header">
            <span className="free-time-badge active">أنت الآن في فترة فراغ</span>
            <span className="free-time-remaining">
              متبقي {formatArabicDuration(freeTimeInfo.minutesRemaining)} حتى المحاضرة القادمة
            </span>
          </div>
          <div className="free-time-details">
            استراحة من {formatArabicTime(freeTimeInfo.currentSlot.startsAt)} إلى{" "}
            {formatArabicTime(freeTimeInfo.currentSlot.endsAt)} (
            {formatArabicDuration(freeTimeInfo.currentSlot.durationMinutes)})
          </div>
        </aside>
      )}

      {freeTimeInfo.status === "upcoming" && (
        <aside className="free-time-card" aria-label="فترة الفراغ القادمة">
          <div className="free-time-header">
            <span className="free-time-title">فترة الفراغ القادمة</span>
            <span className="badge subtle">
              {formatArabicDuration(freeTimeInfo.nextSlot.durationMinutes)}
            </span>
          </div>
          <div className="free-time-details">
            استراحة من {formatArabicTime(freeTimeInfo.nextSlot.startsAt)} إلى{" "}
            {formatArabicTime(freeTimeInfo.nextSlot.endsAt)}
            {freeTimeInfo.minutesUntil <= 60 && (
              <span> · تبدأ بعد {formatArabicDuration(freeTimeInfo.minutesUntil)}</span>
            )}
          </div>
        </aside>
      )}

      {/* REST OF TODAY SESSIONS */}
      <section>
        <div className="section-head">
          <h2>بقية اليوم {todayCode ? `· ${dayNames[todayCode]}` : ""}</h2>
          <Link className="button secondary" href="/schedule">
            عرض جدولي الكامل
          </Link>
        </div>
        <SessionList
          sessions={restOfTodaySessions}
          courses={data.courses}
          empty={
            todayCode
              ? `لا توجد جلسات متبقية اليوم (${dayNames[todayCode]}).`
              : "لا توجد جلسات متبقية اليوم."
          }
        />
      </section>
    </>
  );
}
