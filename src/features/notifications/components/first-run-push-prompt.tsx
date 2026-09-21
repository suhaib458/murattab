"use client";

import { useEffect, useState } from "react";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import {
  enablePushNotifications,
  getPushStatus,
  type PushStatus
} from "@/features/notifications/push-client";

function isIosDevice(): boolean {
  return typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandaloneApp(): boolean {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return navigatorWithStandalone.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches;
}

export function FirstRunPushPrompt({
  data,
  onClose,
  notify
}: {
  data: AppSnapshot;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsIosInstall = isIosDevice() && !isStandaloneApp();

  useEffect(() => {
    void getPushStatus()
      .then((next) => {
        setStatus(next);
        if (next === "enabled") onClose();
      })
      .catch(() => setStatus("unavailable"));
  }, [onClose]);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enablePushNotifications(data);
      notify("تم تفعيل إشعارات المحاضرات على هذا الجهاز.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر تفعيل الإشعارات.");
      setStatus(await getPushStatus().catch((): PushStatus => "unavailable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="push-first-run-title">
      <div className="dialog">
        <h2 id="push-first-run-title">فعّل تذكيرات المحاضرات</h2>
        <p>
          اسمح لـ«مرتب» يرسل لك إشعار قبل موعد محاضرتك حتى ما يفوتك وقتها.
        </p>

        {needsIosInstall && (
          <p className="muted">
            على iPhone لازم أولًا تضيف «مرتب» إلى الشاشة الرئيسية وتفتحه من الأيقونة، وبعدها تقدر تسمح بالإشعارات.
          </p>
        )}

        {status === "denied" && (
          <p style={{ color: "var(--destructive)" }}>
            الإشعارات محظورة على هذا الجهاز. تقدر تفعّلها لاحقًا من إعدادات النظام.
          </p>
        )}

        {error && <p role="alert" style={{ color: "var(--destructive)" }}>{error}</p>}

        <div className="actions">
          {!needsIosInstall && status !== "unsupported" && status !== "unavailable" && status !== "denied" && (
            <button type="button" className="button" onClick={() => void enable()} disabled={busy || status === "loading"}>
              {busy ? "جارٍ التفعيل…" : "تفعيل إشعارات المحاضرات"}
            </button>
          )}
          <button type="button" className="button ghost" onClick={onClose} disabled={busy}>
            {needsIosInstall ? "حسنًا" : "ليس الآن"}
          </button>
        </div>
      </div>
    </div>
  );
}
