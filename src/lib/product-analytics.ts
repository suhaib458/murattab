export type ProductAnalyticsEvent =
  | "smart_import_opened"
  | "schedule_file_selected"
  | "schedule_analysis_started"
  | "schedule_analysis_succeeded"
  | "schedule_analysis_failed"
  | "schedule_adopted";

export type ProductAnalyticsProperties = Record<
  string,
  string | number | boolean | null | undefined
>;

const ANONYMOUS_ID_STORAGE_KEY = "murattab-analytics-anonymous-id";
let memoryAnonymousId: string | null = null;

function createAnonymousId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `anon-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function getAnonymousId(): string {
  if (memoryAnonymousId) return memoryAnonymousId;

  try {
    const existing = window.localStorage.getItem(ANONYMOUS_ID_STORAGE_KEY);
    if (existing) {
      memoryAnonymousId = existing;
      return existing;
    }

    const created = createAnonymousId();
    window.localStorage.setItem(ANONYMOUS_ID_STORAGE_KEY, created);
    memoryAnonymousId = created;
    return created;
  } catch {
    memoryAnonymousId = createAnonymousId();
    return memoryAnonymousId;
  }
}

function cleanProperties(
  properties: ProductAnalyticsProperties
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(properties).filter((entry): entry is [string, string | number | boolean | null] => {
      return entry[1] !== undefined;
    })
  );
}

/**
 * Privacy-preserving product analytics.
 *
 * - Disabled unless NEXT_PUBLIC_POSTHOG_KEY is configured.
 * - Uses a random anonymous identifier stored locally.
 * - Sends no names, university IDs, course names, rooms, timetable contents, or uploaded files.
 * - Does not enable session replay or autocapture.
 */
export function trackProductEvent(
  event: ProductAnalyticsEvent,
  properties: ProductAnalyticsProperties = {}
): void {
  if (typeof window === "undefined") return;
  if (navigator.doNotTrack === "1") return;

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!apiKey) return;

  const host = (process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://us.i.posthog.com").replace(
    /\/+$/,
    ""
  );

  const payload = {
    api_key: apiKey,
    event,
    distinct_id: getAnonymousId(),
    properties: {
      ...cleanProperties(properties),
      $lib: "murattab-web",
      app: "murattab",
      path: window.location.pathname,
      privacy_mode: "anonymous"
    }
  };

  void fetch(`${host}/i/v0/e/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload),
    credentials: "omit",
    keepalive: true
  }).catch(() => {
    // Analytics must never break the student experience.
  });
}
