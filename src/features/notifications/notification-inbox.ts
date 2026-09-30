export type InboxNotification = {
  id: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  receivedAt: number;
  read: boolean;
};

const DATABASE_NAME = "murattab-notification-inbox";
const STORE_NAME = "items";

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openInboxDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getInboxNotifications(): Promise<InboxNotification[]> {
  if (!canUseIndexedDb()) return [];

  const database = await openInboxDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => {
      database.close();
      const items = request.result as InboxNotification[];
      resolve(items.sort((first, second) => second.receivedAt - first.receivedAt));
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}

export async function markInboxNotificationsRead(): Promise<void> {
  if (!canUseIndexedDb()) return;

  const database = await openInboxDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      for (const item of request.result as InboxNotification[]) {
        if (!item.read) store.put({ ...item, read: true });
      }
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export function isSafeNotificationPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//");
}
