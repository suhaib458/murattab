"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  disablePushNotifications,
  enablePushNotifications,
  getNotificationPreferences,
  getPushStatus,
  sendTestPushNotification,
  updateNotificationPreferences,
  type NotificationPreferences,
  type PushStatus
} from "@/features/notifications/push-client";

const statusCopy: Record<PushStatus, string> = {
  loading: "جارٍ فحص حالة هذا الجهاز…",
  unsupported: "هذا المتصفح أو الجهاز لا يدعم إشعارات Web Push.",
  unavailable: "خدمة الإشعارات غير متاحة من الخادم حاليًا.",
  denied: "الإشعارات محظورة على هذا الجهاز.",
  disabled: "الإشعارات متوقفة على هذا الجهاز.",
  enabled: "الإشعارات مفعّلة. اختر بالأسفل الأنواع اللي بدك توصل لجهازك."
};

type PreferenceKey = keyof NotificationPreferences;

const preferenceRows: Array<{
  key: PreferenceKey;
  title: string;
  description: string;
  badge?: string;
}> = [
  {
    key: "classReminders",
    title: "تذكيرات المحاضرات",
    description: "تنبيه قبل كل محاضرة حسب الوقت المحدد لكل مادة.",
    badge: "أساسي"
  },
  {
    key: "tomorrowSummary",
    title: "ملخص دوام بكرا",
    description: "الساعة 7 مساءً: عدد المحاضرات، أول مادة، الوقت والقاعة.",
    badge: "مقترح"
  },
  {
    key: "academicCalendar",
    title: "أحداث التقويم الجامعي",
    description: "تنبيه قبل يوم من السحب والإضافة، الامتحانات، العطل والمواعيد الرسمية.",
    badge: "مقترح"
  },
  {
    key: "morningBriefing",
    title: "ملخص بداية اليوم",
    description: "تنبيه صباحي ذكي قبل بداية دوامك بدون تكرار قريب من تنبيه أول محاضرة."
  },
  {
    key: "dayComplete",
    title: "انتهاء الدوام",
    description: "تنبيه خفيف بعد آخر محاضرة في يومك."
  }
];

function isIosDevice(): boolean {
  return typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return navigatorWithStandalone.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
}

export function PushNotificationSettings({
  data,
  notify
}: {
  data: AppSnapshot;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [busy, setBusy] = useState(false);
  const [savingKey, setSavingKey] = useState<PreferenceKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsIosInstall, setNeedsIosInstall] = useState(false);

  const hasCourseReminders = useMemo(
    () => data.courses.some((course) => course.reminder.enabled),
    [data.courses]
  );

  useEffect(() => {
    setPreferences(getNotificationPreferences());
    setNeedsIosInstall(isIosDevice() && !isStandaloneApp());

    void getPushStatus()
      .then(setStatus)
      .catch(() => setStatus("unavailable"));
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePushNotifications(data);
      setPreferences(getNotificationPreferences());
      setStatus("enabled");
      await sendTestPushNotification();
      notify("تم تفعيل إشعارات مرتب وإرسال إشعار تجريبي لهذا الجهاز.");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "تعذّر تفعيل الإشعارات.";
      setError(message);
      setStatus(await getPushStatus().catch((): PushStatus => "unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setError(null);
    try {
      await disablePushNotifications();
      setStatus("disabled");
      notify("تم إيقاف الإشعارات على هذا الجهاز.");
    } catch (cause) {
      setStatus("disabled");
      setError(cause instanceof Error ? cause.message : "توقفت محليًا، وتعذّر تحديث الخادم.");
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendTestPushNotification();
      notify("تم إرسال إشعار تجريبي لهذا الجهاز.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر إرسال الإشعار التجريبي.");
    } finally {
      setBusy(false);
    }
  };

  const togglePreference = async (key: PreferenceKey) => {
    if (status !== "enabled" || savingKey) return;
    const previous = preferences;
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    setSavingKey(key);
    setError(null);

    try {
      await updateNotificationPreferences(data, next);
    } catch (cause) {
      setPreferences(previous);
      setError(cause instanceof Error ? cause.message : "تعذّر حفظ تفضيلات الإشعارات.");
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="settings-group" aria-label="إشعارات الجهاز">
      <h3>الإشعارات</h3>

      <div className="setting notification-setting">
        <span className="row-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M10 21h4" />
          </svg>
        </span>

        <div className="notification-setting-body">
          <h2>إشعارات مرتب على هذا الجهاز</h2>
          <p aria-live="polite">{statusCopy[status]}</p>

          {needsIosInstall && (
            <p className="notification-note">
              على iPhone لازم تضيف «مرتب» إلى الشاشة الرئيسية من زر المشاركة، وبعدها تفتحه من الأيقونة وتفعّل الإشعارات.
            </p>
          )}

          {status === "denied" && (
            <p className="notification-note">
              إذا كنت تستخدم iPhone افتح «الإعدادات ← الإشعارات ← مرتب» واسمح بالإشعارات، ثم ارجع للتطبيق.
            </p>
          )}

          {error && <p className="notification-error" role="alert">{error}</p>}
        </div>

        <div className="notification-actions">
          {status === "enabled" ? (
            <>
              <button type="button" className="button secondary" onClick={() => void sendTest()} disabled={busy || Boolean(savingKey)}>
                تجربة
              </button>
              <button type="button" className="button ghost" onClick={() => void disable()} disabled={busy || Boolean(savingKey)}>
                إيقاف
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button"
              onClick={() => void enable()}
              disabled={
                busy
                || status === "loading"
                || status === "unsupported"
                || status === "unavailable"
                || status === "denied"
                || needsIosInstall
              }
            >
              {busy ? "جارٍ التفعيل…" : "تفعيل الإشعارات"}
            </button>
          )}
        </div>
      </div>

      {status === "enabled" && (
        <div className="notification-preferences" aria-label="أنواع الإشعارات">
          <div className="notification-preferences-header">
            <div>
              <h2>شو بدك مرتب يذكّرك فيه؟</h2>
              <p>التفضيلات خاصة بهذا الجهاز، وتقدر تغيّرها بأي وقت.</p>
            </div>
            <span className="notification-private-badge">بدون بيانات شخصية</span>
          </div>

          {preferenceRows.map((item) => {
            const enabled = preferences[item.key];
            const saving = savingKey === item.key;
            return (
              <div className="notification-preference-row" key={item.key}>
                <div className="notification-preference-copy">
                  <div className="notification-preference-title">
                    <strong>{item.title}</strong>
                    {item.badge && <span>{item.badge}</span>}
                  </div>
                  <p>{item.description}</p>
                  {item.key === "classReminders" && enabled && !hasCourseReminders && (
                    <small>
                      ما عندك حاليًا مادة مفعّل إلها تنبيه. فعّل التذكير من إعداد المادة أولًا.
                    </small>
                  )}
                </div>

                <button
                  type="button"
                  className="notification-switch"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={(enabled ? "إيقاف " : "تفعيل ") + item.title}
                  disabled={Boolean(savingKey)}
                  data-checked={enabled ? "true" : "false"}
                  onClick={() => void togglePreference(item.key)}
                >
                  <span aria-hidden="true" />
                  <span className="sr-only">{saving ? "جارٍ الحفظ" : enabled ? "مفعّل" : "متوقف"}</span>
                </button>
              </div>
            );
          })}

          <p className="notification-preferences-footnote">
            «مرتب» يرسل فقط تفاصيل التذكير اللازمة مثل اسم المادة والوقت والقاعة، ولا يرسل اسم الطالب أو رقمه الجامعي.
          </p>
        </div>
      )}
    </div>
  );
}
