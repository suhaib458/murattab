"use client";

import Image from "next/image";
import { useForm } from "react-hook-form";
import { ttuConfig } from "@/config/ttu";
import type { AppSettings, StudentProfile } from "@/domain/models";
import { generateId } from "@/lib/uuid";

export function Onboarding({
  onComplete
}: {
  onComplete: (
    profile: StudentProfile,
    settings: AppSettings,
    term: { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean }
  ) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<{ name: string; facultyId: string; majorId: string }>({
    defaultValues: { facultyId: "", majorId: "" }
  });
  const facultyId = watch("facultyId");
  const majorId = watch("majorId");
  const majors = ttuConfig.majors.filter((major) => major.facultyId === facultyId);

  // If the chosen faculty does not contain the currently selected major, reset major.
  const majorIsValidForFaculty = facultyId
    ? ttuConfig.majors.some((m) => m.id === majorId && m.facultyId === facultyId)
    : false;

  return (
    <section className="onboarding card">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <Image
          src="/icons/icon-192.png"
          alt="شعار مرتب"
          width={72}
          height={72}
          style={{ borderRadius: 16, margin: "0 auto", display: "inline-block", boxShadow: "var(--shadow)" }}
          priority
        />
      </div>
      <p className="eyebrow">مرحبًا بك في مرتب</p>
      <h1>لنرتّب فصلك الدراسي</h1>
      <p className="muted">
        هذه البيانات تبقى على جهازك محليًا بالكامل. تعتمد القوائم أدناه على بيانات جامعة الطفيلة التقنية الرسمية الحالية.
      </p>
      <form
        className="form"
        onSubmit={handleSubmit(async (values) => {
          if (!values.facultyId) {
            return;
          }
          const allowedMajors = ttuConfig.majors.filter((m) => m.facultyId === values.facultyId);
          if (!allowedMajors.some((m) => m.id === values.majorId)) {
            return;
          }
          const profile: StudentProfile = {
            id: generateId(),
            name: values.name.trim(),
            universityId: "ttu",
            facultyId: values.facultyId,
            majorId: values.majorId,
            createdAt: new Date().toISOString()
          };
          // Production AcademicTerm: first semester 2026/2027.
          // teaching start = 2026-10-04, last teaching day = 2027-01-07 (verified)
          const term = {
            id: generateId(),
            name: "الفصل الدراسي الأول 2026/2027",
            startsOn: "2026-10-04",
            endsOn: "2027-01-07",
            isCurrent: true
          };
          await onComplete(
            profile,
            {
              id: "settings",
              theme: "light",
              onboardingComplete: true,
              splashShown: true,
              activeTermId: term.id,
              guideSeen: true,
              completedGuideVersion: null,
              guideAutoTrigger: true,
              schemaVersion: 1
            },
            term
          );
        })}
      >
        <label className="field">
          الاسم
          <input
            autoFocus
            {...register("name", {
              required: "اكتب اسمك أولًا",
              validate: (value) => value.trim().length > 0 || "اكتب اسمك أولًا"
            })}
          />
          {errors.name && <span role="alert">{errors.name.message}</span>}
        </label>
        <label className="field">
          الكلية
          <select
            {...register("facultyId", {
              required: "اختر الكلية أولًا"
            })}
          >
            <option value="">اختر الكلية</option>
            {ttuConfig.faculties.map((faculty) => (
              <option value={faculty.id} key={faculty.id}>
                {faculty.name}
              </option>
            ))}
          </select>
          {errors.facultyId && <span role="alert">{errors.facultyId.message}</span>}
        </label>
        <label className="field">
          التخصص
          <select
            {...register("majorId", {
              validate: (value) => {
                if (!facultyId) return "اختر الكلية أولًا";
                if (!value) return "اختر التخصص";
                return ttuConfig.majors.some((m) => m.id === value && m.facultyId === facultyId) ||
                  "التخصص لا يتبع الكلية المختارة";
              }
            })}
            disabled={!facultyId}
          >
            <option value="">{facultyId ? "اختر التخصص" : "اختر الكلية أولًا"}</option>
            {majors.map((major) => (
              <option value={major.id} key={major.id}>
                {major.name}
              </option>
            ))}
          </select>
          {errors.majorId && <span role="alert">{errors.majorId.message}</span>}
        </label>
        <button
          className="button"
          disabled={isSubmitting || !facultyId || !majorIsValidForFaculty}
        >
          {isSubmitting ? "جارٍ الحفظ…" : "ابدأ مع مرتب"}
        </button>
      </form>
    </section>
  );
}
