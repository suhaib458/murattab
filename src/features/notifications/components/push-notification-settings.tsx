"use client";

import { useEffect, useState } from "react";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushStatus,
  sendTestPushNotification,
  type PushStatus
} from "@/features/notifications/push-client";

const statusCopy: Record<PushStatus, string> = {
  loading: "جارٍ فحص حالة هذا الجهاز…",
  unsupported: "هذا المتصفح أو الجهاز لا يدعم Web Push.",
  unavailable: "خدمة الإشعارات غير مجهّزة على الخادم بعد.",
  denied: "الإشعارات محظورة. اسمح بها من إعدادات المتصفح أو الجهاز.",
  disabled: "متوقفة على هذا الجهاز.",
  enabled: "مفعّلة على هذا الجهاز، وستصل تذكيرات المواد التي فعّلت تنبيهها."
};

export function PushNotificationSettings({
  data,
  notify
}: {
  data: AppSnapshot;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsIosInstall, setNeedsIosInstall] = useState(false);

  useEffect(() => {
    void getPushStatus().then((nextStatus) => {
      const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
      const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      setNeedsIosInstall(isiOS && navigatorWithStandalone.standalone !== true);
      setStatus(nextStatus);
    }).catch(() => setStatus("unavailable"));
  }, []);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePushNotifications(data);
      setStatus("enabled");
      await sendTestPushNotification();
      notify("تم تفعيل إشعارات الجهاز وإرسال إشعار تجريبي.");
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
          <h2>تذكيرات المحاضرات على الجهاز</h2>
          <p aria-live="polite">{statusCopy[status]}</p>
          {needsIosInstall && (
            <p className="notification-note">
              على iPhone: اختر «إضافة إلى الشاشة الرئيسية» من قائمة المشاركة، وافتح مرتب من الأيقونة، ثم فعّل الإشعارات.
            </p>
          )}
          {error && <p className="notification-error" role="alert">{error}</p>}
        </div>
        <div className="notification-actions">
          {status === "enabled" ? (
            <>
              <button type="button" className="button secondary" onClick={sendTest} disabled={busy}>
                تجربة
              </button>
              <button type="button" className="button ghost" onClick={disable} disabled={busy}>
                إيقاف
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button"
              onClick={enable}
              disabled={busy || status === "loading" || status === "unsupported" || status === "unavailable" || status === "denied" || needsIosInstall}
            >
              {busy ? "جارٍ التفعيل…" : "تفعيل"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
