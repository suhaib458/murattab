"use client";

import { useState } from "react";
import Link from "next/link";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import type { ClassSession, Course, DayCode } from "@/domain/models";
import {
  calculateFreeTimeSlots,
  dayNames,
  formatArabicTime,
  formatDurationMinutes,
  getDayCodeFromJsDay,
  sortSessions
} from "@/domain/schedule";
import { SessionList } from "@/components/shared/session-list";

export function HomeView({ data }: { data: AppSnapshot }) {
  const todayJsDay = new Date().getDay();
  const todayCode = getDayCodeFromJsDay(todayJsDay);
  const todaySessions = todayCode ? sortSessions(data.sessions.filter((session) => session.day === todayCode)) : [];
  const nowTime = new Date().toTimeString().slice(0, 5);

  const currentSession = todaySessions.find((s) => s.startsAt <= nowTime && s.endsAt > nowTime);
  const upcomingSession = todaySessions.find((s) => s.startsAt > nowTime);
  const activeSession = currentSession ?? upcomingSession;
  const activeCourse = data.courses.find((item) => item.id === activeSession?.courseId);
  const allEnded = todaySessions.length > 0 && !activeSession;

  const freeSlots = calculateFreeTimeSlots(todaySessions);
  const remainingTodaySessions = todaySessions.filter((s) => s.endsAt > nowTime);

  return (
    <>
      <section className="hero">
        <div className="next-card" aria-live="polite" data-tour="next-class">
          {currentSession && activeCourse ? (
            <>
              <p className="eyebrow">المحاضرة الحالية (جارية الآن)</p>
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
            </>
          ) : upcomingSession && activeCourse ? (
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
            </>
          ) : allEnded ? (
            <>
              <p className="eyebrow">محاضرات اليوم</p>
              <h2>انتهت جميع محاضراتك اليوم</h2>
              <p className="muted">لقد أتممت جدول هذا اليوم بنجاح.</p>
            </>
          ) : todayCode ? (
            <>
              <p className="eyebrow">محاضرات اليوم · {dayNames[todayCode]}</p>
              <h2>لا توجد محاضرات مجدولة لهذا اليوم</h2>
              <p className="muted">استمتع بوقت فراغك، أو تفقّد جدول بقية الأسبوع.</p>
            </>
          ) : (
            <>
              <p className="eyebrow">عطلة نهاية الأسبوع (الجمعة)</p>
              <h2>عطلة نهاية الأسبوع</h2>
              <p className="muted">لا توجد محاضرات يوم الجمعة.</p>
            </>
          )}
        </div>
      </section>

      {freeSlots.length > 0 && (
        <aside className="free-time-card" aria-label="فترات الفراغ اليوم">
          <h3>فترات الفراغ بين المحاضرات اليوم</h3>
          {freeSlots.map((slot, index) => (
            <div className="free-time-item" key={index}>
              <span>
                استراحة من {formatArabicTime(slot.startsAt)} إلى {formatArabicTime(slot.endsAt)}
              </span>
              <span className="badge subtle">{formatDurationMinutes(slot.durationMinutes)}</span>
            </div>
          ))}
        </aside>
      )}

      <section>
        <div className="section-head">
          <h2>بقية اليوم {todayCode ? `· ${dayNames[todayCode]}` : ""}</h2>
          <Link className="button secondary" href="/schedule">
            عرض جدولي الكامل
          </Link>
        </div>
        <SessionList
          sessions={remainingTodaySessions}
          courses={data.courses}
          empty={todayCode ? `لا توجد جلسات متبقية اليوم (${dayNames[todayCode]}).` : "لا توجد جلسات متبقية اليوم."}
        />
      </section>
    </>
  );
}
