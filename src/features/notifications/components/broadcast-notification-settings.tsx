"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  getPushAdminStatus,
  sendBroadcastPushNotification
} from "@/features/notifications/push-client";

const DEFAULT_TITLE = "إشعار تجريبي";
const DEFAULT_BODY = "من صهيب إلى جميع الأجهزة";

export function BroadcastNotificationSettings({
  notify
}: {
  notify: (message: string) => void;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [url, setUrl] = useState("/");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getPushAdminStatus().then((admin) => {
      if (active) setIsAdmin(admin);
    }).catch(() => {
      if (active) setIsAdmin(false);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!isAdmin) return null;

  const requestConfirmation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!title.trim() || !body.trim()) {
      setError("اكتب عنوان الإشعار ونصه قبل الإرسال.");
      return;
    }
    setConfirming(true);
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await sendBroadcastPushNotification({
        title: title.trim(),
        body: body.trim(),
        url
      });
      setConfirming(false);
      notify(
        result.queued === 0
          ? "ما في أجهزة مفعّلة للإشعارات حاليًا."
          : `تم تجهيز الإشعار للإرسال إلى ${result.queued} جهاز. عادةً يصل خلال أقل من دقيقة.`
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذّر إرسال الإشعار العام.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-group" aria-label="إدارة الإشعارات العامة">
      <h3>إدارة الإشعارات</h3>
      <div className="setting" style={{ display: "block" }}>
        <div style={{ marginBottom: 14 }}>
          <h2>إرسال إشعار إلى جميع الأجهزة</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            هذا القسم ظاهر فقط على أجهزة الإدارة المصرّح لها. الإشعار يصل لكل جهاز فعّل إشعارات مرتب.
          </p>
        </div>

        <form className="form" onSubmit={requestConfirmation}>
          <label className="field">
            <span>عنوان الإشعار</span>
            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setConfirming(false);
              }}
              maxLength={120}
              autoComplete="off"
            />
            <small className="muted">{title.length}/120</small>
          </label>

          <label className="field">
            <span>نص الإشعار</span>
            <textarea
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
                setConfirming(false);
              }}
              maxLength={240}
              rows={3}
            />
            <small className="muted">{body.length}/240</small>
          </label>

          <label className="field">
            <span>الصفحة التي تفتح عند الضغط على الإشعار</span>
            <select
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setConfirming(false);
              }}
            >
              <option value="/">الرئيسية</option>
              <option value="/schedule">جدولي</option>
              <option value="/calendar">التقويم</option>
              <option value="/settings">الإعدادات</option>
            </select>
          </label>

          {error && <p role="alert" style={{ color: "var(--destructive)", margin: 0 }}>{error}</p>}

          {!confirming ? (
            <button type="submit" className="button" disabled={busy}>
              إرسال إلى جميع الأجهزة
            </button>
          ) : (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 14,
                display: "grid",
                gap: 10
              }}
            >
              <strong>تأكيد الإرسال العام</strong>
              <p className="muted" style={{ margin: 0 }}>
                سيتم إرسال «{title.trim()}» إلى جميع الأجهزة المفعّلة، وليس لهذا الجهاز فقط.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => void send()}
                  disabled={busy}
                >
                  {busy ? "جارٍ الإرسال…" : "نعم، أرسل للجميع"}
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
