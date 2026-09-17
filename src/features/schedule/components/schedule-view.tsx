"use client";

import { useState } from "react";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import type { DayCode } from "@/domain/models";
import {
  dayNames,
  orderedDays,
  sortSessions
} from "@/domain/schedule";
import { SessionList } from "@/components/shared/session-list";

export function ScheduleView({
  data,
  openCourse,
  openImport
}: {
  data: AppSnapshot;
  openCourse: () => void;
  openImport: () => void;
}) {
  const [day, setDay] = useState<DayCode>("ح");
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

      <div className="tabs" role="tablist" aria-label="أيام الأسبوع">
        {orderedDays.map((code) => {
          const count = data.sessions.filter((s) => s.day === code).length;
          return (
            <button
              role="tab"
              aria-selected={day === code}
              key={code}
              onClick={() => setDay(code)}
            >
              {dayNames[code]} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      <SessionList
        sessions={sessions}
        courses={data.courses}
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
