"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellIcon } from "@/components/shared/nav-icon";
import {
  clearInboxNotifications,
  getInboxNotifications,
  isSafeNotificationPath,
  markInboxNotificationsRead,
  type InboxNotification
} from "@/features/notifications/notification-inbox";

function formatReceivedAt(receivedAt: number): string {
  return new Intl.DateTimeFormat("ar-JO", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit"
  }).format(receivedAt);
}

export function NotificationInboxButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<InboxNotification[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const unreadCount = items.filter((item) => !item.read).length;

  const refresh = useCallback(async () => {
    try {
      setItems(await getInboxNotifications());
    } catch {
      // The inbox is an enhancement. Browsers that block IndexedDB can still receive notifications.
      setItems([]);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);

    const handleServiceWorkerMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === "murattab:push-received") void refresh();
    };
    const handleWindowFocus = () => void refresh();

    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.clearTimeout(initialRefresh);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!isOpen) return;

    const closeWhenNeeded = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        setIsOpen(false);
        return;
      }
      if (event instanceof MouseEvent && wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", closeWhenNeeded);
    document.addEventListener("mousedown", closeWhenNeeded);
    return () => {
      document.removeEventListener("keydown", closeWhenNeeded);
      document.removeEventListener("mousedown", closeWhenNeeded);
    };
  }, [isOpen]);

  const toggleInbox = () => {
    const opening = !isOpen;
    setIsOpen(opening);
    if (!opening) return;

    setConfirmClear(false);
    setClearMessage(null);
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    void markInboxNotificationsRead().catch(() => undefined);
  };

  const clearAll = async () => {
    setIsClearing(true);
    try {
      await clearInboxNotifications();
      setItems([]);
      setConfirmClear(false);
      setClearMessage("تم مسح جميع الإشعارات.");
    } catch {
      setClearMessage("تعذّر مسح الإشعارات. حاول مرة أخرى.");
    } finally {
      setIsClearing(false);
    }
  };

  const openNotification = (item: InboxNotification) => {
    if (isSafeNotificationPath(item.url)) window.location.assign(item.url);
    setIsOpen(false);
  };

  return (
    <div className="notification-inbox-wrap" ref={wrapperRef}>
      <button
        type="button"
        className="notification-inbox-trigger"
        aria-label={unreadCount > 0 ? `الإشعارات، ${unreadCount} غير مقروءة` : "الإشعارات"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={toggleInbox}
      >
        <BellIcon />
        {unreadCount > 0 && <span className="notification-inbox-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {isOpen && (
        <section className="notification-inbox" role="dialog" aria-label="الإشعارات">
          <div className="notification-inbox-head">
            <h2>الإشعارات</h2>
            <div className="notification-inbox-actions">
              {items.length > 0 && (
                <button type="button" className="notification-inbox-clear" onClick={() => setConfirmClear(true)}>
                  مسح الكل
                </button>
              )}
              <button type="button" className="notification-inbox-close" onClick={() => setIsOpen(false)} aria-label="إغلاق الإشعارات">
                ×
              </button>
            </div>
          </div>

          {confirmClear ? (
            <div className="notification-inbox-confirm" role="alertdialog" aria-labelledby="clear-inbox-title" aria-describedby="clear-inbox-description">
              <h3 id="clear-inbox-title">مسح جميع الإشعارات؟</h3>
              <p id="clear-inbox-description">سيُحذف سجل الإشعارات من هذا الجهاز ولا يمكن استعادته.</p>
              <div className="notification-inbox-confirm-actions">
                <button type="button" className="button danger" onClick={() => void clearAll()} disabled={isClearing}>
                  {isClearing ? "جارٍ المسح…" : "نعم، امسح الكل"}
                </button>
                <button type="button" className="button ghost" onClick={() => setConfirmClear(false)} disabled={isClearing}>
                  إلغاء
                </button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <>
              {clearMessage && <p className="notification-inbox-status" role="status">{clearMessage}</p>}
            <p className="notification-inbox-empty">لا توجد إشعارات بعد.</p>
            </>
          ) : (
            <ul className="notification-inbox-list">
              {items.map((item) => (
                <li key={item.id}>
                  <button type="button" className="notification-inbox-item" onClick={() => openNotification(item)}>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <time dateTime={new Date(item.receivedAt).toISOString()}>{formatReceivedAt(item.receivedAt)}</time>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
