"use client";

import type { DayCode } from "@/domain/models";
import type { ClassSession } from "@/domain/models";
import { dayNames, orderedDays, getDayCodeFromJsDay } from "@/domain/schedule";

export function ScheduleDaySelector({
  day,
  setDay,
  sessions,
  todayCode
}: {
  day: DayCode;
  setDay: (code: DayCode) => void;
  sessions: ClassSession[];
  todayCode: DayCode | null;
}) {
  const showGoToToday = todayCode !== null && day !== todayCode;

  return (
    <div className="schedule-day-bar">
      <div className="tabs" role="tablist" aria-label="أيام الأسبوع">
        {orderedDays.map((code) => {
          const count = sessions.filter((s) => s.day === code).length;
          const isToday = code === todayCode;
          return (
            <button
              role="tab"
              aria-selected={day === code}
              key={code}
              onClick={() => setDay(code)}
              className={isToday ? "is-today" : ""}
            >
              {dayNames[code]} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>
      {showGoToToday && (
        <button
          type="button"
          className="today-btn"
          onClick={() => setDay(todayCode)}
          aria-label="الانتقال لليوم الحالي"
        >
          اليوم
        </button>
      )}
    </div>
  );
}
