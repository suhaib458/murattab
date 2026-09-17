"use client";

import { useForm } from "react-hook-form";
import { ttuConfig } from "@/config/ttu";

/**
 * Non-destructive "Refresh faculty/major" flow.
 *
 * Shown when an existing profile's facultyId/majorId is either a V0
 * legacy placeholder UUID or simply no longer resolvable in the
 * current canonical TTU dataset. The profile, name, courses, sessions,
 * and settings are kept untouched. Only facultyId and majorId are updated.
 */
export function LegacyAcademicRefresh({
  currentName,
  onSave,
  onSkip
}: {
  currentName: string;
  onSave: (facultyId: string, majorId: string) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<{ facultyId: string; majorId: string }>({
    defaultValues: { facultyId: "", majorId: "" }
  });
  const facultyId = watch("facultyId");
  const majorId = watch("majorId");
  const majors = ttuConfig.majors.filter((m) => m.facultyId === facultyId);
  const majorIsValidForFaculty = facultyId
    ? ttuConfig.majors.some((m) => m.id === majorId && m.facultyId === facultyId)
    : false;

  return (
    <section className="onboarding card">
      <p className="eyebrow">تحديث بياناتك الجامعية</p>
      <h1>حدّث بياناتك الجامعية</h1>
      <p className="muted">
        أهلًا {currentName}. اعتمدنا قوائم جامعة الطفيلة التقنية الرسمية في «مرتب»، لذلك نحتاج منك اختيار كليتك وتخصصك الحاليين فقط. جدولك وإعداداتك ستبقى كما هي.
      </p>
      <form
        className="form"
        onSubmit={handleSubmit(async (values) => {
          if (!values.facultyId) return;
          if (!ttuConfig.majors.some((m) => m.id === values.majorId && m.facultyId === values.facultyId)) {
            return;
          }
          await onSave(values.facultyId, values.majorId);
        })}
      >
        <label className="field">
          الكلية
          <select {...register("facultyId", { required: "اختر الكلية" })}>
            <option value="">اختر الكلية</option>
            {ttuConfig.faculties.map((f) => (
              <option value={f.id} key={f.id}>{f.name}</option>
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
            {majors.map((m) => (
              <option value={m.id} key={m.id}>{m.name}</option>
            ))}
          </select>
          {errors.majorId && <span role="alert">{errors.majorId.message}</span>}
        </label>
        <div className="actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="submit"
            className="button"
            disabled={isSubmitting || !facultyId || !majorIsValidForFaculty}
          >
            {isSubmitting ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => void onSkip()}
            disabled={isSubmitting}
          >
            تخطي الآن
          </button>
        </div>
      </form>
    </section>
  );
}
