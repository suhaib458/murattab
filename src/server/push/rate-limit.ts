type Entry = { count: number; resetAt: number };

const globalRateStore = globalThis as typeof globalThis & {
  __murattabPushRateLimits?: Map<string, Entry>;
};

const store = globalRateStore.__murattabPushRateLimits ?? new Map<string, Entry>();
globalRateStore.__murattabPushRateLimits = store;

export function checkPushRateLimit(
  request: Request,
  scope: string,
  options: { limit: number; windowMs: number }
): Response | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const current = store.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + options.windowMs }
    : { count: current.count + 1, resetAt: current.resetAt };
  store.set(key, entry);

  if (store.size > 10_000) {
    for (const [storedKey, storedEntry] of store) {
      if (storedEntry.resetAt <= now) store.delete(storedKey);
    }
  }

  if (entry.count <= options.limit) return null;
  const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
  return Response.json(
    { error: "طلبات كثيرة للإشعارات. جرّب مرة أخرى بعد قليل." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

