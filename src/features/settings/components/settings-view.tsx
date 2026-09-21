"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { AppSettings } from "@/domain/models";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import { makeBackup } from "@/domain/backup";
import { ttuConfig } from "@/config/ttu";
import { LocalScheduleRepository } from "@/storage/local-repository";
import { PushNotificationSettings } from "@/features/notifications/components/push-notification-settings";
import { disablePushNotifications } from "@/features/notifications/push-client";

const repo = new LocalScheduleRepository();

function subscribeSystemTheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSystemThemeSnapshot() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getSystemThemeServerSnapshot() {
  return false;
}

export function SettingsView({
  data,
  openRestore,
  openImport,
  openManage,
  openCourse,
  startTour,
  refresh,
  notify
}: {
  data: AppSnapshot;
  openRestore: () => void;
  openImport: () => void;
  openManage: () => void;
  openCourse: () => void;
  startTour: () => void;
  refresh: () => Promise<void>;
  notify: (value: string) => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  const update = async (patch: Partial<AppSettings>) => {
    await repo.saveSettings({ ...data.settings, ...patch });
    await refresh();
  };

  const download = () => {
    const backupData = makeBackup(data);
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `murattab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("تم تصدير النسخة الاحتياطية بنجاح.");
  };

  const activeTerm = data.terms.find((term) => term.id === data.settings.activeTermId) ?? data.terms[0];
  const facultyName = ttuConfig.faculties.find((f) => f.id === data.profile?.facultyId)?.name ?? "كلية عامة";
  const majorName = ttuConfig.majors.find((m) => m.id === data.profile?.majorId)?.name ?? "تخصص عام";

  const profileName = data.profile?.name ?? "طالب";
  const profileInitials = (() => {
    const parts = profileName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "م";
    if (parts.length === 1) return parts[0].slice(0, 1);
    return (parts[0][0] + parts[parts.length - 1][0]);
  })();

  const setTheme = (value: AppSettings["theme"]) => {
    void update({ theme: value });
  };

  const systemIsDark = useSyncExternalStore(
    subscribeSystemTheme,
    getSystemThemeSnapshot,
    getSystemThemeServerSnapshot
  );

  return (
    <section className="settings-shell">
      <p className="eyebrow">الإعدادات</p>
      <h1 style={{ marginBottom: 16 }}>الإعدادات</h1>

      <div className="profile-card" aria-label="بطاقة الطالب">
        <div className="avatar" aria-hidden="true">
          <span>{profileInitials}</span>
        </div>
        <div className="body">
          <h2>{profileName}</h2>
          <p>{ttuConfig.name}</p>
          <p className="meta">
            <span>{facultyName}</span>
            <span>·</span>
            <span>{majorName}</span>
          </p>
        </div>
      </div>

      <div className="settings-group" aria-label="المظهر">
        <h3>المظهر</h3>
        <div className="setting" style={{ display: "block" }}>
          <div style={{ marginBottom: 10 }}>
            <h2>الوضع</h2>
            <p className="muted">
              {data.settings.theme === "system"
                ? `تلقائي — حسب إعداد جهازك · ${systemIsDark ? "داكن الآن" : "فاتح الآن"}`
                : "فاتح، داكن، أو تلقائي — حسب إعداد جهازك."}
            </p>
          </div>
          <div className="segmented" role="group" aria-label="اختر وضع المظهر">
            <button
              type="button"
              aria-pressed={data.settings.theme === "light"}
              onClick={() => setTheme("light")}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
              فاتح
            </button>
            <button
              type="button"
              aria-pressed={data.settings.theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
              </svg>
              داكن
            </button>
            <button
              type="button"
              aria-pressed={data.settings.theme === "system"}
              aria-label="تلقائي — حسب إعداد جهازك"
              title="تلقائي — حسب إعداد جهازك"
              onClick={() => setTheme("system")}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              تلقائي
            </button>
          </div>
        </div>
      </div>

      <div className="settings-group" aria-label="الأكاديمي">
        <h3>الأكاديمي</h3>
        <div className="settings-row" role="group" aria-label="الفصل الأكاديمي">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 9h18M8 3v4M16 3v4" />
            </svg>
          </span>
          <div className="row-body">
            <h2>الفصل الأكاديمي الحالي</h2>
            <p>
              {activeTerm ? `${activeTerm.name} (${activeTerm.startsOn} → ${activeTerm.endsOn})` : "غير محدد"}
            </p>
          </div>
        </div>
        <div className="settings-row" role="group" aria-label="الملف الأكاديمي">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </span>
          <div className="row-body">
            <h2>الملف الأكاديمي</h2>
            <p>{facultyName} · {majorName}</p>
          </div>
        </div>
      </div>

      <PushNotificationSettings data={data} notify={notify} />

      <div className="settings-group" aria-label="الجدول">
        <h3>الجدول</h3>
        <button
          type="button"
          className="settings-row"
          onClick={openManage}
          data-tour="course-management"
        >
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M4 5h16v4H4zM4 12h16v4H4zM4 19h16" />
            </svg>
          </span>
          <div className="row-body">
            <h2>إدارة المواد</h2>
            <p>تعديل أو حذف المواد المسجلة في جدولك ({data.courses.length})</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <button type="button" className="settings-row" onClick={openImport}>
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M12 9v6M9 12h6M7 3v2M17 3v2" />
            </svg>
          </span>
          <div className="row-body">
            <h2>استيراد جدول</h2>
            <p>تحليل صورة أو PDF لجدولك ومراجعته قبل الحفظ.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <Link href="/calendar" className="settings-row" aria-label="افتح التقويم الأكاديمي">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="5" width="18" height="15" rx="2" />
              <path d="M8 3v4M16 3v4M3.5 10h17" />
            </svg>
          </span>
          <div className="row-body">
            <h2>التقويم الأكاديمي</h2>
            <p>عرض أحداث الفصل الرسمي للجامعة.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </Link>
      </div>

      <div className="settings-group" aria-label="البيانات والنسخ الاحتياطي">
        <h3>البيانات والنسخ الاحتياطي</h3>
        <button type="button" className="settings-row" onClick={download}>
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M12 4v12M6 12l6 6 6-6M4 20h16" />
            </svg>
          </span>
          <div className="row-body">
            <h2>تصدير نسخة احتياطية</h2>
            <p>احفظ ملف JSON لجدولك وملفك على جهازك.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <button type="button" className="settings-row" onClick={openRestore}>
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M12 20V8M6 14l6-6 6 6M4 4h16" />
            </svg>
          </span>
          <div className="row-body">
            <h2>استعادة نسخة احتياطية</h2>
            <p>استرجع بياناتك من ملف JSON محفوظ مسبقًا.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <button type="button" className="settings-row" onClick={() => setConfirmClear(true)}>
          <span className="row-icon danger" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
            </svg>
          </span>
          <div className="row-body">
            <h2>حذف جميع البيانات</h2>
            <p>مسح كامل للملف والمواد والجلسات من هذا المتصفح.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>

      <div className="settings-group" aria-label="المساعدة">
        <h3>المساعدة</h3>
        <button type="button" className="settings-row" onClick={startTour} data-tour="replay-guide">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .8-1.5 1.3-1.5 2.5M12 17h.01" />
            </svg>
          </span>
          <div className="row-body">
            <h2>دليل استخدام «مرتب»</h2>
            <p>تعرّف على أهم مزايا التطبيق خطوة بخطوة</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <button type="button" className="settings-row" onClick={openCourse}>
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <div className="row-body">
            <h2>إضافة مادة يدويًا</h2>
            <p>افتح نموذج إضافة مادة جديدة لجدولك.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>

      <div className="settings-group" aria-label="حول التطبيق">
        <h3>حول التطبيق</h3>
        <div className="settings-row" role="group" aria-label="الخصوصية والإصدار">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4Z" />
            </svg>
          </span>
          <div className="row-body">
            <h2>الخصوصية والإصدار</h2>
            <p>مرتب 0.1.0 · يبقى ملفك وجدولك محليين. عند تفعيل إشعارات الجهاز تُرسل تفاصيل التذكيرات الضرورية فقط وبلا اسم أو رقم جامعي.</p>
          </div>
        </div>

        <div className="about-social-section">
          <div className="about-social-header">
            <h4 className="about-social-title">صُنع بجهد وحب لطلاب الجامعة</h4>
            <p className="about-social-subtitle">إذا عجبكم «مرتب»، دعمكم بمتابعتنا بيفرق 🤍</p>
          </div>
          <div className="about-social-links">
            <a
              href="https://instagram.com/suhaib.s6"
              target="_blank"
              rel="noopener noreferrer"
              className="about-social-link"
              aria-label="متابعة على إنستغرام: @suhaib.s6 (يفتح في علامة تبويب جديدة)"
            >
              <span className="about-social-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
              </span>
              <span className="about-social-label">
                <span className="about-social-network">Instagram</span>
              </span>
              <span className="about-social-external" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </span>
            </a>

            <a
              href="https://www.linkedin.com/in/suhaib-abu-afifeh"
              target="_blank"
              rel="noopener noreferrer"
              className="about-social-link"
              aria-label="زيارة الحساب على لينكد إن (يفتح في علامة تبويب جديدة)"
            >
              <span className="about-social-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                  <rect x="2" y="9" width="4" height="12" />
                  <circle cx="4" cy="4" r="2" />
                </svg>
              </span>
              <span className="about-social-label">
                <span className="about-social-network">LinkedIn</span>
              </span>
              <span className="about-social-external" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </span>
            </a>
          </div>
        </div>
      </div>

      {confirmClear && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="clear-title">
          <div className="dialog">
            <h2 id="clear-title">تأكيد حذف جميع البيانات</h2>
            <p>
              تحذير: سيؤدي هذا إلى مسح كافة بياناتك وجدولك والمواد المسجلة من هذا المتصفح. لن تتمكن من التراجع عن هذه الخطوة إلا إذا كان لديك ملف نسخة احتياطية.
            </p>
            <div className="actions" style={{ marginTop: 20 }}>
              <button
                className="button danger"
                onClick={async () => {
                  await disablePushNotifications().catch(() => {});
                  await repo.clear();
                  setConfirmClear(false);
                  await refresh();
                  notify("تم مسح كافة البيانات المحلية.");
                }}
              >
                نعم، امسح كل البيانات
              </button>
              <button className="button ghost" onClick={() => setConfirmClear(false)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
