type Entry = { count: number; resetAt: number };

const globalRateStore = globalThis as typeof globalThis & {
  __murattabPushRateLimits?: Map<string, Entry>;
};

const store = globalRateStore.__murattabPushRateLimits ?? new Map<string, Entry>();
globalRateStore.__murattabPushRateLimits = store;

function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function checkPushRateLimit(
  request: Request,
  scope: string,
  options: { limit: number; windowMs: number },
  subject?: string
): Response | null {
  // Device-authenticated push endpoints must not share a rate-limit bucket
  // just because several students are behind the same campus Wi-Fi or mobile
  // carrier NAT. Use a stable device subject when available and fall back to
  // the client IP only for anonymous/broad abuse protection.
  const normalizedSubject = subject?.trim();
  const identity = normalizedSubject
    ? `device:${normalizedSubject}`
    : `ip:${requestIp(request)}`;
  const key = `${scope}:${identity}`;
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
