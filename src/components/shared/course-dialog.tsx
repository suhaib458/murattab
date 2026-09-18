"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import type { ClassSession, Course, DayCode } from "@/domain/models";
import {
  dayNames,
  expandRoom,
  findConflicts,
  formatArabicTime,
  makeSessions,
  orderedDays
} from "@/domain/schedule";
import { LocalScheduleRepository } from "@/storage/local-repository";
import { generateId } from "@/lib/uuid";

type CourseForm = {
  name: string;
  kind: "lecture" | "lab" | "unspecified";
  days: DayCode[];
  startsAt: string;
  endsAt: string;
  room: string;
  reminder: boolean;
  minutesBefore: number;
};

const repo = new LocalScheduleRepository();

export function CourseDialog({
  data,
  courseToEdit,
  close,
  saved
}: {
  data: AppSnapshot;
  courseToEdit?: Course | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const existingForCourse = courseToEdit ? data.sessions.filter((s) => s.courseId === courseToEdit.id) : [];
  const defaultDays = existingForCourse.length ? existingForCourse.map((s) => s.day) : [];
  const defaultStartsAt = existingForCourse[0]?.startsAt ?? "08:00";
  const defaultEndsAt = existingForCourse[0]?.endsAt ?? "09:00";
  const defaultKind = existingForCourse[0]?.kind ?? "lecture";
  const defaultRoom = existingForCourse[0]?.room.raw ?? "";
  const defaultReminder = courseToEdit?.reminder.enabled ?? true;
  const defaultMinutesBefore = courseToEdit?.reminder.minutesBefore ?? 10;

  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [pendingSessions, setPendingSessions] = useState<{ course: Course; sessions: ClassSession[] } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<CourseForm>({
    defaultValues: {
      name: courseToEdit?.name ?? "",
      kind: defaultKind,
      days: defaultDays,
      startsAt: defaultStartsAt,
      endsAt: defaultEndsAt,
      room: defaultRoom,
      reminder: defaultReminder,
      minutesBefore: defaultMinutesBefore
    }
  });

  const onSubmit = async (values: CourseForm) => {
    const courseId = courseToEdit?.id ?? generateId();
    const termId = data.settings.activeTermId ?? data.terms[0]?.id;
    if (!termId) return;

    const sessions = makeSessions({
      courseId,
      days: values.days,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      room: expandRoom(values.room),
      kind: values.kind
    });

    const conflicts = findConflicts(sessions, data.sessions, courseToEdit?.id);

    const courseData: Course = {
      id: courseId,
      termId,
      name: values.name.trim(),
      reminder: {
        enabled: values.reminder,
        minutesBefore: Number(values.minutesBefore)
      },
      createdAt: courseToEdit?.createdAt ?? new Date().toISOString()
    };

    if (conflicts.length > 0) {
      const details = conflicts
        .map((c) => {
          const conflictingCourse = data.courses.find((item) => item.id === c.other.courseId);
          return `«${conflictingCourse?.name ?? "مادة أخرى"}» يوم ${dayNames[c.other.day]} (${formatArabicTime(c.other.startsAt)} إلى ${formatArabicTime(c.other.endsAt)})`;
        })
        .join("، ");

      setConflictWarning(`يوجد تعارض زمني مع: ${details}.`);
      setPendingSessions({ course: courseData, sessions });
      return;
    }

    await repo.saveCourse(courseData, sessions);
    await saved();
  };

  const confirmConflictSave = async () => {
    if (!pendingSessions) return;
    await repo.saveCourse(pendingSessions.course, pendingSessions.sessions);
    await saved();
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <div className="dialog">
        <div className="section-head">
          <h2 id="add-title">{courseToEdit ? "تعديل المادة" : "إضافة مادة يدويًا"}</h2>
          <button className="button ghost" aria-label="إغلاق" onClick={close}>
            إغلاق
          </button>
        </div>

        {conflictWarning && (
          <div className="notice" role="alert" style={{ marginBottom: 16 }}>
            <p><strong>تنبيه تعارض المواعيد:</strong></p>
            <p>{conflictWarning}</p>
            <p>هل تريد حفظ المادة رغم هذا التعارض؟</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="button warning" onClick={confirmConflictSave}>
                نعم، احفظ رغم التعارض
              </button>
              <button className="button secondary" onClick={() => setConflictWarning(null)}>
                الرجوع والتعديل
              </button>
            </div>
          </div>
        )}

        <form className="form" onSubmit={handleSubmit(onSubmit)}>
          <label className="field">
            اسم المادة
            <input
              autoFocus
              {...register("name", {
                required: "اسم المادة مطلوب",
                validate: (value) => value.trim().length > 0 || "اسم المادة مطلوب"
              })}
            />
            {errors.name && <span role="alert">{errors.name.message}</span>}
          </label>

          <label className="field">
            النوع
            <select {...register("kind")}>
              <option value="lecture">نظري</option>
              <option value="lab">عملي</option>
              <option value="unspecified">غير محدد</option>
            </select>
          </label>

          <fieldset className="field">
            <legend>الأيام</legend>
            <div className="check-grid">
              {orderedDays.map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    value={day}
                    {...register("days", {
                      validate: (value) => value.length > 0 || "اختر يومًا واحدًا على الأقل"
                    })}
                  />
                  {dayNames[day]}
                </label>
              ))}
            </div>
            {errors.days && <span role="alert">{errors.days.message}</span>}
          </fieldset>

          <div className="grid">
            <label className="field">
              وقت البداية
              <input type="time" {...register("startsAt")} />
            </label>
            <label className="field">
              وقت النهاية
              <input
                type="time"
                {...register("endsAt", {
                  validate: (value) => value > watch("startsAt") || "يجب أن يأتي وقت النهاية بعد وقت البداية"
                })}
              />
              {errors.endsAt && <span role="alert">{errors.endsAt.message}</span>}
            </label>
          </div>

          <label className="field">
            القاعة أو عبر الإنترنت
            <input
              placeholder="مثال: 207 م، 105 هـ، 204 ع، أو Online"
              {...register("room", { required: "اكتب القاعة أو Online" })}
            />
            {errors.room && <span role="alert">{errors.room.message}</span>}
          </label>

          <label className="field">
            التنبيه قبل المحاضرة (بالدقائق)
            <input
              type="number"
              min="0"
              max="10080"
              {...register("minutesBefore", { valueAsNumber: true })}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" {...register("reminder")} /> تفعيل التنبيه قبل المحاضرة
          </label>

          <button className="button" disabled={isSubmitting}>
            {isSubmitting ? "جارٍ الحفظ…" : courseToEdit ? "تحديث المادة" : "حفظ المادة"}
          </button>
        </form>
      </div>
    </div>
  );
}
