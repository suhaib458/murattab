"use client";

import { useState, useTransition } from "react";
import { readBackup } from "@/domain/backup";
import { LocalScheduleRepository } from "@/storage/local-repository";

const repo = new LocalScheduleRepository();

export function RestoreDialog({ close, restored }: { close: () => void; restored: () => Promise<void> }) {
  const [candidate, setCandidate] = useState<ReturnType<typeof readBackup>["data"] | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError("الملف المحدد ليس بصيغة JSON صالحة أو به تلف.");
        setCandidate(null);
        return;
      }

      const result = readBackup(parsed);
      if (result.success) {
        setCandidate(result.data);
        setError("");
      } else {
        setError("ملف النسخة الاحتياطية غير متوافق مع هيكل بيانات مرتب.");
        setCandidate(null);
      }
    } catch {
      setError("تعذر قراءة ملف النسخة الاحتياطية.");
      setCandidate(null);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="restore-title">
      <div className="dialog">
        <div className="section-head">
          <h2 id="restore-title">استعادة نسخة احتياطية</h2>
          <button className="button ghost" onClick={close} aria-label="إغلاق">
            إغلاق
          </button>
        </div>

        <p className="muted">اختر ملف النسخة الاحتياطية (JSON) المحفوظ على جهازك لاسترجاع جدولك وبياناتك.</p>

        <label className="field" style={{ margin: "16px 0" }}>
          <span>ملف النسخة (JSON)</span>
          <input type="file" accept="application/json" onChange={(e) => startTransition(() => void handleFile(e))} />
        </label>

        {error && <p role="alert" style={{ color: "var(--destructive)", fontWeight: 700 }}>{error}</p>}

        {candidate && (
          <div className="card" style={{ margin: "16px 0" }}>
            <h3>تفاصيل النسخة الجاهزة للاستعادة:</h3>
            <p><strong>اسم الطالب:</strong> {candidate.profile?.name ?? "غير مسجل"}</p>
            <p><strong>عدد المواد:</strong> {candidate.courses.length}</p>
            <p><strong>عدد الجلسات الأسبوعية:</strong> {candidate.sessions.length}</p>
            <p><strong>تاريخ التصدير:</strong> {new Date(candidate.exportedAt).toLocaleString("ar-JO")}</p>
            <div className="notice" style={{ marginTop: 12 }}>
              سيتم استبدال الجدول والبيانات المحلية الحالية بالكامل بمحتويات هذا الملف.
            </div>
            <div className="actions" style={{ marginTop: 16 }}>
              <button
                className="button warning"
                onClick={async () => {
                  await repo.replace(candidate);
                  await restored();
                }}
              >
                تأكيد الاستبدال والاستعادة
              </button>
            </div>
          </div>
        )}

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="button ghost" onClick={close}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
