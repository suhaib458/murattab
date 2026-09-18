"use client";

import { useEffect, useState } from "react";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import type { DayCode } from "@/domain/models";
import {
  dayNames,
  getDayCodeFromJsDay,
  getInitialScheduleDay,
  sortSessions
} from "@/domain/schedule";
import { ScheduleDaySelector } from "./schedule-day-selector";
import { ScheduleSessionList } from "./schedule-session-list";

export function ScheduleView({
  data,
  openCourse,
  openImport
}: {
  data: AppSnapshot;
  openCourse: () => void;
  openImport: () => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const todayJsDay = now.getDay();
  const todayCode = getDayCodeFromJsDay(todayJsDay);
  const nowTime = now.toTimeString().slice(0, 5);

  const [day, setDay] = useState<DayCode>(() =>
    getInitialScheduleDay(data.sessions, todayJsDay)
  );

  const sessions = sortSessions(data.sessions.filter((item) => item.day === day));

  return (
    <section>
      <div className="section-head">
        <div>
          <p className="eyebrow">جدولي</p>
          <h1>أسبوعك الدراسي</h1>
        </div>
        <div className="actions" data-tour="schedule-actions">
          <button className="button" onClick={openCourse}>
            إضافة مادة
          </button>
          <button className="button secondary" onClick={openImport}>
            استيراد الجدول
          </button>
        </div>
      </div>

      <ScheduleDaySelector
        day={day}
        setDay={setDay}
        sessions={data.sessions}
        todayCode={todayCode}
      />

      <ScheduleSessionList
        sessions={sessions}
        courses={data.courses}
        day={day}
        todayCode={todayCode}
        nowTime={nowTime}
        empty={`لا توجد جلسات يوم ${dayNames[day]}.`}
      />

      {data.courses.length === 0 && (
        <div className="card glass" style={{ textAlign: "center", padding: "32px 16px", marginTop: 24 }}>
          <p className="eyebrow">جدولك فارغ حاليًا</p>
          <h2>ابدأ بإنشاء جدولك الدراسي</h2>
          <p className="muted" style={{ maxWidth: 440, margin: "0 auto 20px" }}>
            يمكنك استيراد جدولك مباشرة برفع صورة أو ملف PDF، أو إضافة المواد والمحاضرات يدويًا.
          </p>
          <div className="actions" style={{ justifyContent: "center" }}>
            <button className="button" onClick={openImport}>
              استيراد الجدول (صورة أو PDF)
            </button>
            <button className="button secondary" onClick={openCourse}>
              إضافة مادة يدويًا
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
