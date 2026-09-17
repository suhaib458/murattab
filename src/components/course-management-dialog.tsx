"use client";

/**
 * Phase 3.5C — Course management dialog.
 *
 * A dedicated panel that lists every course with Edit / Delete actions.
 * Reuses the same `repo.deleteCourse` path as the legacy in-page list, so
 * deletion semantics, conflict handling, and backup compatibility are
 * preserved.
 *
 * Mobile: presented as a full-height sheet (`role="dialog"` + `aria-modal`).
 * Desktop: same dialog, centered within the viewport.
 */

import { useState } from "react";
import type { Course } from "@/domain/models";
import type { AppSnapshot, ScheduleRepository } from "@/repositories/schedule-repository";
import { dayNames, orderedDays } from "@/domain/schedule";

export function CourseManagementDialog({
  data,
  editCourse,
  openCourse,
  close,
  refresh,
  notify,
  repo
}: {
  data: AppSnapshot;
  editCourse: (course: Course) => void;
  openCourse: () => void;
  close: () => void;
  refresh: () => Promise<void>;
  notify: (value: string) => void;
  repo: ScheduleRepository;
}) {
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);

  const courses = data.courses;
  const totalSessions = data.sessions.length;

  return (
    <div
      className="dialog-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-title"
    >
      <div className="dialog manage-dialog" data-tour="course-management-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">الجدول</p>
            <h2 id="manage-title">إدارة المواد</h2>
            <p className="muted" style={{ marginTop: 4 }}>
              {courses.length} مادة · {totalSessions} جلسة أسبوعية
            </p>
          </div>
          <button
            className="button ghost"
            onClick={close}
            aria-label="إغلاق إدارة المواد"
          >
            إغلاق
          </button>
        </div>

        {courses.length === 0 ? (
          <div className="card glass" style={{ marginTop: 16, textAlign: "center", padding: "28px 16px" }}>
            <p className="eyebrow">ما عندك مواد مضافة لسه</p>
            <h3>ابدأ بإضافة أول مادة لجدولك</h3>
            <p className="muted" style={{ maxWidth: 420, margin: "8px auto 16px" }}>
              من هنا بتقدر تعدّل أي مادة أو تحذفها لاحقًا.
            </p>
            <div className="actions" style={{ justifyContent: "center" }}>
              <button
                className="button"
                onClick={() => {
                  close();
                  window.setTimeout(() => openCourse(), 60);
                }}
              >
                إضافة مادة
              </button>
            </div>
          </div>
        ) : (
          <div className="manage-list" style={{ marginTop: 16 }}>
            {courses.map((course) => {
              const courseSessions = data.sessions.filter((s) => s.courseId === course.id);
              const days = orderedDays
                .filter((code) => courseSessions.some((s) => s.day === code))
                .map((code) => dayNames[code])
                .join(" · ");
              return (
                <article key={course.id} className="card manage-card">
                  <div className="manage-card-body">
                    <h3>{course.name}</h3>
                    <p className="muted">
                      {courseSessions.length} جلسات أسبوعية
                      {days ? ` · ${days}` : ""}
                      {course.reminder.enabled ? ` · تنبيه قبل ${course.reminder.minutesBefore} د` : ""}
                    </p>
                  </div>
                  <div className="actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        close();
                        window.setTimeout(() => editCourse(course), 60);
                      }}
                    >
                      تعديل
                    </button>
                    <button
                      type="button"
                      className="button danger"
                      onClick={() => setCourseToDelete(course)}
                    >
                      حذف
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {courseToDelete && (
          <div
            className="dialog-backdrop inner"
            role="dialog"
            aria-modal="true"
            aria-labelledby="del-course-title"
          >
            <div className="dialog">
              <h2 id="del-course-title">تأكيد حذف المادة</h2>
              <p>
                هل أنت متأكد من حذف مادة <strong>«{courseToDelete.name}»</strong>؟ سيتم حذف جميع الجلسات المرتبطة بها في مختلف الأيام.
              </p>
              <div className="actions" style={{ marginTop: 20 }}>
                <button
                  className="button danger"
                  onClick={async () => {
                    await repo.deleteCourse(courseToDelete.id);
                    setCourseToDelete(null);
                    await refresh();
                    notify("تم حذف المادة وجلساتها بنجاح.");
                  }}
                >
                  نعم، احذف المادة
                </button>
                <button className="button ghost" onClick={() => setCourseToDelete(null)}>
                  إلغاء
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
