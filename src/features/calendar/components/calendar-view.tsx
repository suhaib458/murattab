"use client";

import { useState } from "react";
import type { AcademicCalendarEvent, DayCode } from "@/domain/models";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import {
  dayNames,
  getDayCodeFromJsDay,
  sortSessions
} from "@/domain/schedule";
import { getEventsOnDate, getSessionsOnAcademicDate, ttuAcademicCalendar } from "@/domain/calendar";
import { SessionList } from "@/components/shared/session-list";

function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const arabicMonths = [
  "كانون الثاني (يناير)",
  "شباط (فبراير)",
  "آذار (مارس)",
  "نيسان (أبريل)",
  "أيار (مايو)",
  "حزيران (يونيو)",
  "تموز (يوليو)",
  "آب (أغسطس)",
  "أيلول (سبتمبر)",
  "تشرين الأول (أكتوبر)",
  "تشرين الثاني (نوفمبر)",
  "كانون الأول (ديسمبر)"
];

const dayOfWeekHeaders = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

const academicEventKindLabel: Record<AcademicCalendarEvent["kind"], string> = {
  registration: "تسجيل",
  exam: "امتحان",
  holiday: "عطلة",
  other: "حدث أكاديمي"
};

const academicEventKindToken: Record<AcademicCalendarEvent["kind"], string> = {
  registration: "var(--accent)",
  exam: "var(--warning)",
  holiday: "var(--success)",
  other: "var(--foreground-muted)"
};

export function CalendarView({ data }: { data: AppSnapshot }) {
  // Calendar state: Year and Month
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDayNum, setSelectedDayNum] = useState<number>(() => new Date().getDate());

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  // Saturday-first indexing (0 = Saturday, 1 = Sunday, ..., 6 = Friday)
  const firstDayJs = new Date(year, month, 1).getDay();
  const firstDayOffset = (firstDayJs + 1) % 7;
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

  const daysArray = Array.from({ length: totalDaysInMonth }, (_, index) => index + 1);

  // Selected date details
  const safeSelected = Math.min(selectedDayNum, totalDaysInMonth);
  const selectedDateObj = new Date(year, month, safeSelected);
  const selectedDayCode = getDayCodeFromJsDay(selectedDateObj.getDay());
  const selectedIsoDate = toIsoDateLocal(selectedDateObj);
  const selectedDaySessions = sortSessions(
    getSessionsOnAcademicDate(data.sessions, data.courses, data.terms, selectedIsoDate)
  );
  const selectedEvents = getEventsOnDate(ttuAcademicCalendar.events, selectedIsoDate);

  const isToday = (dayNum: number) => {
    const today = new Date();
    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === dayNum;
  };

  return (
    <section>
      <p className="eyebrow">التقويم الشهري</p>
      <h1 style={{ marginBottom: 14 }}>{arabicMonths[month]} {year}</h1>

      <div className="calendar-shell">
        <div className="calendar-header">
          <button className="button secondary" onClick={prevMonth} aria-label="الشهر السابق">
            الشهر السابق
          </button>
          <h2>{arabicMonths[month]} {year}</h2>
          <button className="button secondary" onClick={nextMonth} aria-label="الشهر التالي">
            الشهر التالي
          </button>
        </div>

        <div className="week-headers" role="row" aria-hidden="true">
          {dayOfWeekHeaders.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>

        <div className="month" role="grid" aria-label={`تقويم ${arabicMonths[month]} ${year}`}>
          {Array.from({ length: firstDayOffset }).map((_, i) => (
            <div className="day-cell empty-cell" key={`empty-${i}`} aria-hidden="true" />
          ))}

          {daysArray.map((date) => {
            const cellDateObj = new Date(year, month, date);
            const cellDayCode = getDayCodeFromJsDay(cellDateObj.getDay());
            const cellIsoDate = toIsoDateLocal(cellDateObj);
            const sessionCount = cellDayCode
              ? getSessionsOnAcademicDate(data.sessions, data.courses, data.terms, cellIsoDate).length
              : 0;
            const cellEvents = getEventsOnDate(ttuAcademicCalendar.events, cellIsoDate);
            const isSelected = safeSelected === date;

            return (
              <button
                className={`day-cell ${sessionCount ? "has-session" : ""} ${isSelected ? "selected" : ""} ${isToday(date) ? "today" : ""}`}
                key={date}
                onClick={() => setSelectedDayNum(date)}
                aria-label={`${date} ${arabicMonths[month]}، ${sessionCount} جلسات${cellEvents.length ? `، ${cellEvents.length} أحداث` : ""}`}
              >
                <span className="day-num">{date}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  {cellEvents.length > 0 && (
                    <span
                      className="event-strip"
                      title={cellEvents.map((e) => `${academicEventKindLabel[e.kind]}: ${e.title}`).join("\n")}
                      aria-label={`${cellEvents.length} أحداث`}
                    >
                      {cellEvents.slice(0, 3).map((e) => (
                        <span key={e.id} className={`event-dot ${e.kind}`} />
                      ))}
                    </span>
                  )}
                  {sessionCount > 0 && (
                    <span className="badge" title={`${sessionCount} محاضرات`}>
                      {sessionCount}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="section-head">
        <h2>
          محاضرات يوم {selectedDayCode ? dayNames[selectedDayCode] : "الجمعة"} {safeSelected} {arabicMonths[month]}
        </h2>
      </div>

      <SessionList
        sessions={selectedDaySessions}
        courses={data.courses}
        empty={
          selectedDayCode
            ? `لا توجد جلسات مجدولة ليوم ${dayNames[selectedDayCode]} ${safeSelected} ${arabicMonths[month]}.`
            : "يوم الجمعة عطلة أسبوعية؛ لا توجد محاضرات."
        }
      />

      {selectedEvents.length > 0 && (
        <section className="settings-group" style={{ marginTop: 16 }} aria-label={`أحداث التقويم الأكاديمي ليوم ${safeSelected} ${arabicMonths[month]}`}>
          <h3>أحداث التقويم الأكاديمي</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {selectedEvents.map((event) => (
              <li
                key={event.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  background: "var(--surface-muted)",
                  borderRadius: "var(--radius-md)"
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    minWidth: 6,
                    height: 28,
                    borderRadius: 3,
                    backgroundColor: academicEventKindToken[event.kind]
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{event.title}</div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    {event.endsOn && event.endsOn !== event.startsOn
                      ? `${event.startsOn} → ${event.endsOn}`
                      : event.startsOn}
                    {" · "}
                    {academicEventKindLabel[event.kind]}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
