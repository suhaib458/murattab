"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClassSession, Course, DayCode, ExtractionIssue, RoomLocation, ScheduleExtractionResult } from "@/domain/models";
import { dayNames, expandRoom, findConflicts, formatArabicTime, getIctLabLabel, orderedDays } from "@/domain/schedule";
import type { AppSnapshot, ScheduleRepository } from "@/repositories/schedule-repository";
import { isSupportedMimeType, MAX_FILE_SIZE_BYTES } from "@/domain/ai/extraction-schema";
import { generateId } from "@/lib/uuid";

interface ImportDialogProps {
  data: AppSnapshot;
  repo: ScheduleRepository;
  close: () => void;
  saved: () => Promise<void>;
  notify: (msg: string) => void;
}

type DialogStep = "upload" | "analyzing" | "review";

export interface EditableSession {
  id: string;
  day: DayCode | "";
  startsAt: string;
  endsAt: string;
  roomRaw: string;
  roomExpanded?: string;
  kind: "lecture" | "lab" | "unspecified";
  confidenceDay?: number;
  confidenceTime?: number;
  confidenceRoom?: number;
}

export interface EditableCourse {
  tempId: string;
  name: string;
  nameConfidence?: number;
  sessions: EditableSession[];
  duplicateAction: "add" | "replace" | "skip";
}

function getSessionExpandedRoomLabel(roomRaw: string, kind?: string, precomputedExpanded?: string): string | null {
  if (precomputedExpanded) return precomputedExpanded;
  const clean = roomRaw.trim();
  if (!clean) return null;
  const exp = expandRoom(clean);
  if (exp.label && exp.label !== clean) {
    return exp.label;
  }
  return getIctLabLabel(clean, kind as "lecture" | "lab" | "unspecified" | undefined);
}

function formatSessionRoom(roomRaw: string, kind?: string, roomExpanded?: string): RoomLocation {
  const clean = roomRaw.trim();
  if (!clean) {
    return { raw: "", label: "غير محدد", isOnline: false };
  }
  const isOnline = /^online$/i.test(clean) || clean === "عبر الإنترنت" || clean === "أونلاين";
  if (isOnline) {
    return { raw: clean, label: "عبر الإنترنت", isOnline: true };
  }
  if (roomExpanded && roomExpanded !== clean) {
    return { raw: clean, label: roomExpanded, isOnline: false };
  }
  const ict = getIctLabLabel(clean, kind as "lecture" | "lab" | "unspecified" | undefined);
  if (ict) {
    return { raw: clean, label: ict, isOnline: false };
  }
  return expandRoom(clean);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} بايت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} ك.ب`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} م.ب`;
}

/**
 * Shared mapper converting ScheduleExtractionResult into EditableCourse[] for Review UI.
 * Used by both Local Image analysis and Cloud/PDF analysis.
 */
export function buildEditableReviewCourses(
  result: ScheduleExtractionResult,
  existingCourses: Course[]
): EditableCourse[] {
  return result.draft.courses.map((c, cIdx) => {
    const isDuplicate = Boolean(
      c.name.trim() &&
      existingCourses.some((ec) => ec.name.trim().toLowerCase() === c.name.trim().toLowerCase())
    );

    const firstSessionCourseId = c.sessions[0]?.courseId;
    const nameConfidence =
      (firstSessionCourseId ? result.confidence[`course_${firstSessionCourseId}_name`] : undefined) ??
      result.confidence[`course_${cIdx}_name`] ??
      (c.name ? result.confidence[`course_${c.name}_name`] : undefined) ??
      0.9;

    return {
      tempId: generateId(),
      name: c.name || "",
      nameConfidence,
      duplicateAction: isDuplicate ? "replace" : "add",
      sessions: c.sessions.map((s) => ({
        id: s.id || generateId(),
        day: s.day || "",
        startsAt: s.startsAt || "",
        endsAt: s.endsAt || "",
        roomRaw: s.roomRaw || "",
        roomExpanded: s.roomExpanded,
        kind: s.kind === "lab" ? "lab" : s.kind === "lecture" ? "lecture" : "unspecified",
        confidenceDay: result.confidence[`session_${s.id}_day`] ?? 0.9,
        confidenceTime: result.confidence[`session_${s.id}_time`] ?? 0.9,
        confidenceRoom: result.confidence[`session_${s.id}_room`] ?? 0.9
      }))
    };
  });
}

export function ImportDialog({ data, repo, close, saved, notify }: ImportDialogProps) {
  const [step, setStep] = useState<DialogStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cloudConsent, setCloudConsent] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Analysis & source state
  const [analyzingStage, setAnalyzingStage] = useState<string>("بدء التحليل…");

  // Attempt generation token & references for honest cancellation
  const analysisAttemptRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Review state
  const [extractedCourses, setExtractedCourses] = useState<EditableCourse[]>([]);
  const [extractionIssues, setExtractionIssues] = useState<ExtractionIssue[]>([]);
  const [confirmConflict, setConfirmConflict] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      analysisAttemptRef.current += 1;
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [previewUrl]);

  // File selection: strictly reset all prior analysis and consent state
  const handleFileSelect = useCallback((selectedFile: File) => {
    // Invalidate any in-progress attempt
    analysisAttemptRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setErrorMessage(null);
    setCloudConsent(false);
    setExtractedCourses([]);
    setExtractionIssues([]);
    setAnalyzingStage("");
    setStep("upload");

    if (!isSupportedMimeType(selectedFile.type)) {
      setErrorMessage("نوع الملف غير مدعوم. الصيغ المدعومة هي: JPG، PNG، WebP، و PDF فقط.");
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setErrorMessage("حجم الملف يتجاوز الحد الأقصى المسموح به وهو 4 ميجابايت.");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }

    setFile(selectedFile);

    if (selectedFile.type.startsWith("image/")) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
    }
  }, [previewUrl]);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // API extraction for images and PDFs (via POST /api/schedule/extract)
  const startCloudExtraction = async () => {
    if (!file) {
      setErrorMessage("يرجى اختيار ملف أولاً.");
      return;
    }
    if (!cloudConsent) {
      setErrorMessage("يرجى الموافقة على شروط التحليل والخصوصية للمتابعة.");
      return;
    }

    analysisAttemptRef.current += 1;
    const currentAttempt = analysisAttemptRef.current;

    setErrorMessage(null);
    setStep("analyzing");
    setAnalyzingStage("رفع الملف لمزود التحليل…");

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("consent", "true");

      const timer = setTimeout(() => {
        if (currentAttempt === analysisAttemptRef.current) {
          setAnalyzingStage("تحليل الجدول واستخراج المحاضرات والقاعات…");
        }
      }, 1200);

      const res = await fetch("/api/schedule/extract", {
        method: "POST",
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timer);
      if (currentAttempt !== analysisAttemptRef.current) return;

      setAnalyzingStage("تجهيز نتائج الجدول للمراجعة…");

      const resData = await res.json().catch(() => null);

      if (!res.ok || !resData?.success) {
        const msg = resData?.error || "تعذر إكمال التحليل الذكي للجدول.";
        setErrorMessage(msg);
        setStep("upload");
        return;
      }

      const result: ScheduleExtractionResult = resData.result;
      const initialCourses = buildEditableReviewCourses(result, data.courses);

      setExtractedCourses(initialCourses);
      setExtractionIssues(result.draft.issues || []);
      setStep("review");
    } catch (err: any) {
      if (currentAttempt !== analysisAttemptRef.current) return;

      if (err.name === "AbortError") {
        setErrorMessage("تم إلغاء عملية التحليل.");
      } else {
        setErrorMessage("حدث خطأ في الاتصال أثناء التحليل. يرجى المحاولة مرة أخرى.");
      }
      setStep("upload");
    } finally {
      abortControllerRef.current = null;
    }
  };

  const cancelAnalysis = () => {
    analysisAttemptRef.current += 1;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStep("upload");
  };

  // Editing handlers in Review step
  const updateCourseName = (tempId: string, name: string) => {
    setExtractedCourses((prev) =>
      prev.map((c) => (c.tempId === tempId ? { ...c, name } : c))
    );
  };

  const updateDuplicateAction = (tempId: string, duplicateAction: "add" | "replace" | "skip") => {
    setExtractedCourses((prev) =>
      prev.map((c) => (c.tempId === tempId ? { ...c, duplicateAction } : c))
    );
  };

  const deleteCourse = (tempId: string) => {
    setExtractedCourses((prev) => prev.filter((c) => c.tempId !== tempId));
  };

  // Manual course name starts completely empty to prevent accidental placeholder persistence
  const addMissingCourse = () => {
    const newCourse: EditableCourse = {
      tempId: generateId(),
      name: "",
      duplicateAction: "add",
      sessions: [
        {
          id: generateId(),
          day: "",
          startsAt: "",
          endsAt: "",
          roomRaw: "",
          kind: "unspecified"
        }
      ]
    };
    setExtractedCourses((prev) => [...prev, newCourse]);
  };

  const updateSession = (courseTempId: string, sessionId: string, patch: Partial<EditableSession>) => {
    setExtractedCourses((prev) =>
      prev.map((c) => {
        if (c.tempId !== courseTempId) return c;
        return {
          ...c,
          sessions: c.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch } : s))
        };
      })
    );
  };

  const addSessionToCourse = (courseTempId: string) => {
    setExtractedCourses((prev) =>
      prev.map((c) => {
        if (c.tempId !== courseTempId) return c;
        const newSession: EditableSession = {
          id: generateId(),
          day: "",
          startsAt: "",
          endsAt: "",
          roomRaw: "",
          kind: "unspecified"
        };
        return {
          ...c,
          sessions: [...c.sessions, newSession]
        };
      })
    );
  };

  const removeSessionFromCourse = (courseTempId: string, sessionId: string) => {
    setExtractedCourses((prev) =>
      prev.map((c) => {
        if (c.tempId !== courseTempId) return c;
        return {
          ...c,
          sessions: c.sessions.filter((s) => s.id !== sessionId)
        };
      })
    );
  };

  // Convert review courses into candidates for conflict and duplicate checking
  const activeReviewCourses = extractedCourses.filter((c) => c.duplicateAction !== "skip");

  // Generate sessions to test for conflicts (only those with valid day and times)
  const candidateSessionsForConflictCheck: ClassSession[] = [];
  activeReviewCourses.forEach((c) => {
    c.sessions.forEach((s) => {
      if (s.day && s.startsAt && s.endsAt && s.endsAt > s.startsAt) {
        candidateSessionsForConflictCheck.push({
          id: s.id,
          courseId: c.tempId,
          day: s.day as DayCode,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          room: formatSessionRoom(s.roomRaw, s.kind, s.roomExpanded),
          kind: s.kind
        });
      }
    });
  });

  // Calculate conflicts against existing schedule
  const existingPoolForConflict = data.sessions.filter((es) => {
    const matchingExtracted = extractedCourses.find(
      (ec) => ec.duplicateAction === "replace" && ec.name.trim().toLowerCase() === data.courses.find((c) => c.id === es.courseId)?.name.trim().toLowerCase()
    );
    return !matchingExtracted;
  });

  const conflicts = findConflicts(candidateSessionsForConflictCheck, existingPoolForConflict);

  // Check if any required field is unresolved
  const hasUnresolvedFields = activeReviewCourses.some(
    (c) =>
      !c.name.trim() ||
      c.sessions.length === 0 ||
      c.sessions.some((s) => !s.day || !s.startsAt || !s.endsAt || s.endsAt <= s.startsAt)
  );

  // Final approval and atomic save
  const handleApprove = async () => {
    setErrorMessage(null);

    if (activeReviewCourses.length === 0) {
      notify("لا توجد مواد معتمدة للحفظ.");
      close();
      return;
    }

    // Strict validation: never persist unresolved required fields
    for (const c of activeReviewCourses) {
      if (!c.name.trim()) {
        setErrorMessage("يرجى إدخال اسم لجميع المواد قبل اعتماد الجدول.");
        return;
      }
      if (c.sessions.length === 0) {
        setErrorMessage(`المادة "${c.name}" لا تحتوي على أي جلسات. يرجى إضافة جلسة أو حذف المادة.`);
        return;
      }
      for (const s of c.sessions) {
        if (!s.day) {
          setErrorMessage(`يرجى تحديد يوم المحاضرة لمادة "${c.name}" قبل الاعتماد.`);
          return;
        }
        if (!s.startsAt || !s.endsAt) {
          setErrorMessage(`يرجى إدخال وقت البداية والنهاية للمحاضرات في مادة "${c.name}".`);
          return;
        }
        if (s.endsAt <= s.startsAt) {
          setErrorMessage(`وقت نهاية المحاضرة يجب أن يكون بعد وقت البداية في مادة "${c.name}".`);
          return;
        }
      }
    }

    if (conflicts.length > 0 && !confirmConflict) {
      notify("يرجى تأكيد رغبتك في الحفظ رغم وجود تعارض في الأوقات.");
      return;
    }

    setIsSaving(true);
    try {
      const termId = data.settings.activeTermId || data.terms[0]?.id || generateId();

      // Handle replacement: delete existing courses marked for replacement
      for (const ec of extractedCourses) {
        if (ec.duplicateAction === "replace") {
          const existing = data.courses.find(
            (c) => c.name.trim().toLowerCase() === ec.name.trim().toLowerCase()
          );
          if (existing) {
            await repo.deleteCourse(existing.id);
          }
        }
      }

      // Prepare batch save
      const batchToSave: Array<{ course: Course; sessions: ClassSession[] }> = [];

      for (const ec of activeReviewCourses) {
        const courseId = generateId();
        const course: Course = {
          id: courseId,
          termId,
          name: ec.name.trim(),
          reminder: { enabled: true, minutesBefore: 15 },
          createdAt: new Date().toISOString()
        };

        const sessions: ClassSession[] = ec.sessions.map((s) => ({
          id: generateId(),
          courseId,
          day: s.day as DayCode,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          room: formatSessionRoom(s.roomRaw, s.kind, s.roomExpanded),
          kind: s.kind
        }));

        batchToSave.push({ course, sessions });
      }

      await repo.saveCourses(batchToSave);
      await saved();

      notify(`تم اعتماد وحفظ ${batchToSave.length} مواد في جدولك بنجاح.`);
      close();
    } catch (err) {
      console.error("Failed to save imported schedule:", err);
      notify("حدث خطأ أثناء حفظ الجدول محلياً.");
    } finally {
      setIsSaving(false);
    }
  };


  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="dialog" style={{ maxWidth: step === "review" ? 720 : 540 }}>
        {/* Header */}
        <div className="section-head">
          <h2 id="import-title">
            {step === "upload" && "استيراد الجدول"}
            {step === "analyzing" && "جاري قراءة جدولك…"}
            {step === "review" && "راجع جدولك قبل الاعتماد"}
          </h2>
          {step !== "analyzing" && (
            <button className="button ghost" aria-label="إغلاق" onClick={close}>
              ✕
            </button>
          )}
        </div>

        {errorMessage && (
          <div className="notice" role="alert" style={{ borderColor: "var(--destructive)", marginBottom: 16 }}>
            <p style={{ color: "var(--destructive)", fontWeight: 700, margin: 0 }}>⚠️ {errorMessage}</p>
          </div>
        )}

        {/* STEP 1: UPLOAD & DISCLOSURE */}
        {step === "upload" && (
          <div className="form">
            <p className="muted" style={{ margin: 0 }}>
              ارفع صورة أو ملف PDF لجدولك الدراسي ليتم تحليله عبر خدمة التحليل الذكي ثم راجع النتائج قبل الاعتماد.
            </p>

            {/* Drag & Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              style={{
                border: `2px dashed ${isDragging ? "var(--primary)" : "var(--border)"}`,
                borderRadius: 16,
                padding: "24px 16px",
                textAlign: "center",
                backgroundColor: isDragging ? "var(--surface-muted)" : "var(--surface)",
                cursor: "pointer",
                transition: "border-color 0.2s, background-color 0.2s"
              }}
              onClick={() => document.getElementById("file-upload-input")?.click()}
            >
              <input
                id="file-upload-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileSelect(e.target.files[0]);
                  }
                }}
              />
              <div style={{ fontSize: "2rem", marginBottom: 8 }}>📄</div>
              <p style={{ fontWeight: 700, margin: "0 0 4px" }}>
                {file ? file.name : "اضغط لاختيار ملف أو اسحبه إلى هنا"}
              </p>
              <p className="muted" style={{ fontSize: "0.85rem", margin: 0 }}>
                الصيغ المدعومة: JPG, PNG, WebP, PDF (حتى 4 ميجابايت)
              </p>
            </div>

            {/* File Details & Preview */}
            {file && (
              <div
                className="card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 12,
                  gap: 12
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {previewUrl ? (
                    <Image
                      src={previewUrl}
                      alt="معاينة الجدول"
                      width={48}
                      height={48}
                      unoptimized
                      style={{ borderRadius: 8, objectFit: "cover" }}
                    />
                  ) : (
                    <span style={{ fontSize: "1.8rem" }}>📑</span>
                  )}
                  <div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: "0.92rem" }}>{file.name}</p>
                    <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                      {formatBytes(file.size)} • {file.type || "مستند"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="button ghost"
                  style={{ color: "var(--destructive)", padding: "4px 8px" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    if (previewUrl) {
                      URL.revokeObjectURL(previewUrl);
                      setPreviewUrl(null);
                    }
                  }}
                >
                  إزالة
                </button>
              </div>
            )}

            {/* API PRIVACY & CLOUD CONSENT */}
            {file && (
              <div
                style={{
                  background: "var(--surface-muted)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                  fontSize: "0.88rem"
                }}
              >
                <p style={{ fontWeight: 700, margin: "0 0 6px", color: "var(--foreground)" }}>
                  ☁️ إشعار الخصوصية والموافقة:
                </p>
                <p style={{ margin: "0 0 8px", color: "var(--foreground-muted)", lineHeight: 1.5 }}>
                  سيتم إرسال الملف إلى مزود التحليل الذكي لغرض قراءة الجدول واستخراج المواد والأيام والمواعيد والقاعات فقط.
                </p>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginTop: 8,
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={cloudConsent}
                    onChange={(e) => setCloudConsent(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: "var(--primary)", cursor: "pointer" }}
                  />
                  <span>أوافق صراحة على إرسال الملف للتحليل لغرض استخراج الجدول</span>
                </label>
              </div>
            )}

            {/* Actions */}
            <div className="actions" style={{ justifyContent: "flex-end", marginTop: 8, gap: 8 }}>
              <button type="button" className="button secondary" onClick={close}>
                إلغاء
              </button>

              {file ? (
                <button
                  type="button"
                  className="button"
                  disabled={!cloudConsent}
                  onClick={startCloudExtraction}
                >
                  بدء التحليل الذكي
                </button>
              ) : (
                <button type="button" className="button" disabled>
                  بدء التحليل الذكي
                </button>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: ANALYZING STATE */}
        {step === "analyzing" && (
          <div style={{ textAlign: "center", padding: "28px 12px" }} aria-live="polite">
            <div
              style={{
                width: 48,
                height: 48,
                border: "4px solid var(--border)",
                borderTopColor: "var(--primary)",
                borderRadius: "50%",
                margin: "0 auto 16px",
                animation: "spin 1s linear infinite"
              }}
            />
            <p data-testid="analyzing-stage" style={{ fontSize: "1.15rem", fontWeight: 800, margin: "0 0 8px" }}>
              {analyzingStage}
            </p>
            <p className="muted" style={{ margin: "0 0 20px" }}>
              يرجى الانتظار بضع ثوانٍ بينما يقوم النظام بقراءة المواد والمواعيد والقاعات بدقة…
            </p>
            <button type="button" className="button secondary" onClick={cancelAnalysis}>
              إلغاء التحليل
            </button>
          </div>
        )}

        {/* STEP 3: REVIEW SCREEN */}
        {step === "review" && (
          <div>
            {/* Analysis Source Badge */}
            <div style={{ marginBottom: 12 }}>
              <span
                data-testid="analysis-source-badge"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 8,
                  fontSize: "0.82rem",
                  fontWeight: 600,
                  backgroundColor: "rgba(99, 102, 241, 0.12)",
                  color: "var(--accent)"
                }}
              >
                <span>☁️</span>
                <span>تم التحليل باستخدام API الذكي</span>
              </span>
            </div>

            <p className="muted" style={{ margin: "0 0 16px" }}>
              تم استخراج <strong>{extractedCourses.length}</strong> مواد. يمكنك تعديل أي حقل، حذف أي مادة، أو إضافة مواد إضافية قبل الاعتماد.
            </p>

            {/* Extraction Issues Banner */}
            {extractionIssues.length > 0 && (
              <div className="notice" style={{ marginBottom: 16 }}>
                <p style={{ fontWeight: 700, margin: "0 0 4px" }}>ملاحظات ومراجعات مقترحة:</p>
                <ul style={{ margin: 0, paddingRight: 18, fontSize: "0.88rem" }}>
                  {extractionIssues.map((issue, idx) => (
                    <li key={idx} style={{ marginBottom: 2 }}>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Courses List */}
            <div style={{ display: "grid", gap: 14, maxHeight: "55vh", overflowY: "auto", paddingRight: 4, marginBottom: 16 }}>
              {extractedCourses.map((course, cIdx) => {
                const isExisting = data.courses.some(
                  (ec) => ec.name.trim().toLowerCase() === course.name.trim().toLowerCase()
                );
                const isLowConfidence = (course.nameConfidence ?? 1) < 0.85;

                return (
                  <div
                    key={course.tempId}
                    className="card"
                    style={{
                      padding: 14,
                      border: isLowConfidence ? "1px solid var(--warning)" : "1px solid var(--border)",
                      opacity: course.duplicateAction === "skip" ? 0.6 : 1
                    }}
                  >
                    {/* Course Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 200 }}>
                        <span style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--foreground-muted)" }}>
                          #{cIdx + 1}
                        </span>
                        <input
                          value={course.name}
                          onChange={(e) => updateCourseName(course.tempId, e.target.value)}
                          placeholder="اسم المادة (مطلوب)"
                          style={{
                            fontWeight: 700,
                            fontSize: "1.05rem",
                            border: `1px solid ${!course.name.trim() ? "var(--destructive)" : isLowConfidence ? "var(--warning)" : "var(--border)"}`,
                            borderRadius: 8,
                            padding: "6px 10px",
                            flex: 1,
                            backgroundColor: "var(--surface)",
                            color: "var(--foreground)"
                          }}
                        />
                        {isLowConfidence && (
                          <span
                            className="badge"
                            style={{ backgroundColor: "var(--warning)", color: "#ffffff", whiteSpace: "nowrap" }}
                            title="درجة ثقة منخفضة، يرجى مراجعة الاسم"
                          >
                            ⚠️ تحتاج انتباه
                          </span>
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button
                          type="button"
                          className="button ghost"
                          style={{ color: "var(--destructive)", padding: "4px 8px", fontSize: "0.85rem" }}
                          title="حذف المادة من الجدول"
                          onClick={() => deleteCourse(course.tempId)}
                        >
                          🗑️ حذف المادة
                        </button>
                      </div>
                    </div>

                    {/* Duplicate Detection Options */}
                    {isExisting && (
                      <div
                        style={{
                          backgroundColor: "var(--surface-muted)",
                          padding: "8px 12px",
                          borderRadius: 8,
                          marginBottom: 10,
                          fontSize: "0.85rem",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          flexWrap: "wrap",
                          gap: 8
                        }}
                      >
                        <span style={{ color: "var(--warning)", fontWeight: 700 }}>
                          ⚠️ مادة مسجلة مسبقًا في جدولك:
                        </span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            type="button"
                            className={`button ${course.duplicateAction === "replace" ? "" : "secondary"}`}
                            style={{ padding: "4px 8px", minHeight: 32, fontSize: "0.78rem" }}
                            onClick={() => updateDuplicateAction(course.tempId, "replace")}
                          >
                            استبدال الموجودة
                          </button>
                          <button
                            type="button"
                            className={`button ${course.duplicateAction === "add" ? "" : "secondary"}`}
                            style={{ padding: "4px 8px", minHeight: 32, fontSize: "0.78rem" }}
                            onClick={() => updateDuplicateAction(course.tempId, "add")}
                          >
                            إبقاء الاثنين
                          </button>
                          <button
                            type="button"
                            className={`button ${course.duplicateAction === "skip" ? "" : "secondary"}`}
                            style={{ padding: "4px 8px", minHeight: 32, fontSize: "0.78rem" }}
                            onClick={() => updateDuplicateAction(course.tempId, "skip")}
                          >
                            تخطي
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Sessions List */}
                    {course.duplicateAction !== "skip" && (
                      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                        {course.sessions.map((sess) => {
                          const expandedLabel = getSessionExpandedRoomLabel(sess.roomRaw, sess.kind, sess.roomExpanded);
                          const sessionLowConfidence =
                            (sess.confidenceDay ?? 1) < 0.85 ||
                            (sess.confidenceTime ?? 1) < 0.85 ||
                            (sess.confidenceRoom ?? 1) < 0.85;

                          return (
                            <div
                              key={sess.id}
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 8,
                                padding: "10px 12px",
                                backgroundColor: "var(--surface-muted)",
                                borderRadius: 10,
                                border: sessionLowConfidence ? "1px solid var(--warning)" : "1px solid var(--border)",
                                fontSize: "0.85rem"
                              }}
                            >
                              {/* Session Top Bar: Kind Badge & Selector, Confidence Warning, Delete Button */}
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <span
                                    className={`kind ${sess.kind === "lab" ? "lab" : ""}`}
                                    style={{ fontSize: "0.78rem", padding: "2px 8px" }}
                                  >
                                    {sess.kind === "lab" ? "عملي" : sess.kind === "lecture" ? "نظري" : "جلسة"}
                                  </span>

                                  <select
                                    value={sess.kind}
                                    aria-label="نوع الجلسة"
                                    onChange={(e) =>
                                      updateSession(course.tempId, sess.id, { kind: e.target.value as any })
                                    }
                                    style={{
                                      padding: "3px 6px",
                                      borderRadius: 6,
                                      border: "1px solid var(--border)",
                                      background: "var(--surface)",
                                      color: "var(--foreground)",
                                      fontSize: "0.8rem",
                                      fontWeight: 600
                                    }}
                                  >
                                    <option value="lecture">نظري</option>
                                    <option value="lab">عملي</option>
                                    <option value="unspecified">غير محدد</option>
                                  </select>

                                  {sessionLowConfidence && (
                                    <span
                                      className="badge"
                                      style={{ backgroundColor: "var(--warning)", color: "#ffffff", fontSize: "0.72rem" }}
                                      title="بيانات الجلسة غير مؤكدة، يرجى مراجعتها"
                                    >
                                      ⚠️ تدقيق
                                    </span>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  className="button ghost"
                                  style={{ padding: "2px 6px", minHeight: "auto", color: "var(--destructive)", fontSize: "0.82rem" }}
                                  title="حذف هذا الموعد"
                                  onClick={() => removeSessionFromCourse(course.tempId, sess.id)}
                                >
                                  ✕ حذف الموعد
                                </button>
                              </div>

                              {/* Session Fields Grid */}
                              <div
                                style={{
                                  display: "grid",
                                  gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                                  gap: 8,
                                  alignItems: "start"
                                }}
                              >
                                {/* Day Selector */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontSize: "0.75rem", color: "var(--foreground-muted)" }}>اليوم</label>
                                  <select
                                    value={sess.day}
                                    aria-label="اليوم"
                                    onChange={(e) =>
                                      updateSession(course.tempId, sess.id, { day: (e.target.value as DayCode) || "" })
                                    }
                                    style={{
                                      padding: "6px 8px",
                                      borderRadius: 6,
                                      border: `1px solid ${!sess.day ? "var(--destructive)" : "var(--border)"}`,
                                      background: "var(--surface)",
                                      color: "var(--foreground)",
                                      fontWeight: 700
                                    }}
                                  >
                                    <option value="">-- اختر اليوم (مطلوب) --</option>
                                    {orderedDays.map((d) => (
                                      <option key={d} value={d}>
                                        {dayNames[d]}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                {/* StartsAt */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontSize: "0.75rem", color: "var(--foreground-muted)" }}>البداية</label>
                                  <input
                                    type="time"
                                    aria-label="وقت البداية"
                                    value={sess.startsAt}
                                    onChange={(e) =>
                                      updateSession(course.tempId, sess.id, { startsAt: e.target.value })
                                    }
                                    style={{
                                      padding: "6px 8px",
                                      borderRadius: 6,
                                      border: `1px solid ${!sess.startsAt ? "var(--destructive)" : "var(--border)"}`,
                                      background: "var(--surface)",
                                      color: "var(--foreground)"
                                    }}
                                  />
                                </div>

                                {/* EndsAt */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontSize: "0.75rem", color: "var(--foreground-muted)" }}>النهاية</label>
                                  <input
                                    type="time"
                                    aria-label="وقت النهاية"
                                    value={sess.endsAt}
                                    onChange={(e) =>
                                      updateSession(course.tempId, sess.id, { endsAt: e.target.value })
                                    }
                                    style={{
                                      padding: "6px 8px",
                                      borderRadius: 6,
                                      border: `1px solid ${!sess.endsAt || (sess.startsAt && sess.endsAt <= sess.startsAt) ? "var(--destructive)" : "var(--border)"}`,
                                      background: "var(--surface)",
                                      color: "var(--foreground)"
                                    }}
                                  />
                                </div>

                                {/* Room */}
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <label style={{ fontSize: "0.75rem", color: "var(--foreground-muted)" }}>القاعة</label>
                                  <input
                                    value={sess.roomRaw}
                                    aria-label="القاعة"
                                    placeholder="مثال: 207 م أو ICT - 4"
                                    onChange={(e) =>
                                      updateSession(course.tempId, sess.id, { roomRaw: e.target.value, roomExpanded: undefined })
                                    }
                                    style={{
                                      padding: "6px 8px",
                                      borderRadius: 6,
                                      border: "1px solid var(--border)",
                                      background: "var(--surface)",
                                      color: "var(--foreground)"
                                    }}
                                  />
                                  {expandedLabel && expandedLabel !== sess.roomRaw && (
                                    <span style={{ fontSize: "0.72rem", color: "var(--accent)", fontWeight: 600 }}>
                                      {expandedLabel}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          className="button ghost"
                          style={{
                            fontSize: "0.82rem",
                            padding: "6px 10px",
                            justifyContent: "flex-start",
                            color: "var(--primary)"
                          }}
                          onClick={() => addSessionToCourse(course.tempId)}
                        >
                          + إضافة موعد آخر لهذه المادة
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Add missing course button */}
            <button
              type="button"
              className="button secondary"
              style={{ width: "100%", marginBottom: 16, borderStyle: "dashed" }}
              onClick={addMissingCourse}
            >
              + إضافة مادة مفقودة يدويًا
            </button>

            {/* Conflict Warning */}
            {conflicts.length > 0 && (
              <div className="notice" role="alert" style={{ marginBottom: 16, borderColor: "var(--warning)" }}>
                <p style={{ fontWeight: 700, margin: "0 0 6px", color: "var(--warning)" }}>
                  ⚠️ تم اكتشاف تعارض في مواعيد المحاضرات ({conflicts.length}):
                </p>
                <ul style={{ margin: "0 0 8px", paddingRight: 18, fontSize: "0.85rem" }}>
                  {conflicts.slice(0, 3).map((cf, idx) => (
                    <li key={idx}>
                      يوم {dayNames[cf.candidate.day]}: المحاضرة ({formatArabicTime(cf.candidate.startsAt)} - {formatArabicTime(cf.candidate.endsAt)}) تتعارض مع جلسة أخرى ({formatArabicTime(cf.other.startsAt)} - {formatArabicTime(cf.other.endsAt)}).
                    </li>
                  ))}
                  {conflicts.length > 3 && <li>و {conflicts.length - 3} تعارضات أخرى…</li>}
                </ul>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontWeight: 700 }}>
                  <input
                    type="checkbox"
                    checked={confirmConflict}
                    onChange={(e) => setConfirmConflict(e.target.checked)}
                    style={{ width: 18, height: 18, accentColor: "var(--warning)", cursor: "pointer" }}
                  />
                  <span>أعلم بوجود هذا التعارض في الأوقات وأريد حفظ الجدول مع ذلك</span>
                </label>
              </div>
            )}

            {/* Unresolved fields warning banner */}
            {hasUnresolvedFields && (
              <div className="notice" role="alert" style={{ borderColor: "var(--destructive)", marginBottom: 16 }}>
                <p style={{ color: "var(--destructive)", fontWeight: 700, margin: 0 }}>
                  ⚠️ يرجى استكمال الحقول الإلزامية المؤشرة (اسم المادة، اليوم، أوقات المحاضرة) قبل اعتماد الجدول.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="actions" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <button
                type="button"
                className="button secondary"
                onClick={() => setStep("upload")}
              >
                إعادة المحاولة بملف آخر
              </button>

              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="button secondary" onClick={close}>
                  إلغاء
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={isSaving || hasUnresolvedFields || (conflicts.length > 0 && !confirmConflict)}
                  title={hasUnresolvedFields ? "يرجى استكمال الحقول المطلوبة قبل الاعتماد" : undefined}
                  onClick={handleApprove}
                >
                  {isSaving ? "جاري الحفظ…" : "اعتماد الجدول"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
