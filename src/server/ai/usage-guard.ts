import { createHash } from "node:crypto";

export type ExtractionCacheSource = "hit" | "miss" | "coalesced";
export type ExtractionLimitScope = "client" | "global";

export interface ExtractionRateLimitDecision {
  allowed: boolean;
  scope?: ExtractionLimitScope;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowCounter {
  count: number;
  resetAt: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_CLIENT_LIMIT = 3;
const DEFAULT_CLIENT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_GLOBAL_LIMIT = 4;
const DEFAULT_GLOBAL_WINDOW_MS = 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_CACHE_MAX_ENTRIES = 100;

const clientWindows = new Map<string, WindowCounter>();
let globalWindow: WindowCounter | null = null;
const resultCache = new Map<string, CacheEntry<unknown>>();
const inFlightExtractions = new Map<string, Promise<unknown>>();

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function secondsUntil(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

function getOrResetWindow(
  current: WindowCounter | undefined | null,
  windowMs: number,
  now: number
): WindowCounter {
  if (!current || current.resetAt <= now) {
    return { count: 0, resetAt: now + windowMs };
  }

  return current;
}

function pruneClientWindows(now: number) {
  if (clientWindows.size < 500) {
    return;
  }

  for (const [key, window] of clientWindows) {
    if (window.resetAt <= now) {
      clientWindows.delete(key);
    }
  }
}

function pruneResultCache(now: number, maxEntries: number) {
  for (const [key, entry] of resultCache) {
    if (entry.expiresAt <= now) {
      resultCache.delete(key);
    }
  }

  while (resultCache.size > maxEntries) {
    const oldestKey = resultCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    resultCache.delete(oldestKey);
  }
}

export function createAnonymousClientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || request.headers.get("x-real-ip") || "unknown";
  const userAgent = request.headers.get("user-agent") || "unknown";
  const language = request.headers.get("accept-language") || "unknown";

  return createHash("sha256")
    .update(`${ip}|${userAgent}|${language}`)
    .digest("hex")
    .slice(0, 24);
}

export function createExtractionCacheKey(bytes: Uint8Array, mimeType: string): string {
  const hash = createHash("sha256");
  hash.update("murattab-schedule-extraction-v1");
  hash.update("\0");
  hash.update(mimeType);
  hash.update("\0");
  hash.update(bytes);
  return hash.digest("hex");
}

export function consumeExtractionRateLimit(
  clientKey: string,
  now = Date.now()
): ExtractionRateLimitDecision {
  const clientLimit = readPositiveInt("AI_CLIENT_RATE_LIMIT_REQUESTS", DEFAULT_CLIENT_LIMIT);
  const clientWindowMs = readPositiveInt(
    "AI_CLIENT_RATE_LIMIT_WINDOW_MS",
    DEFAULT_CLIENT_WINDOW_MS
  );
  const globalLimit = readPositiveInt("AI_GLOBAL_RATE_LIMIT_REQUESTS", DEFAULT_GLOBAL_LIMIT);
  const globalWindowMs = readPositiveInt(
    "AI_GLOBAL_RATE_LIMIT_WINDOW_MS",
    DEFAULT_GLOBAL_WINDOW_MS
  );

  pruneClientWindows(now);

  const clientWindow = getOrResetWindow(clientWindows.get(clientKey), clientWindowMs, now);
  const currentGlobalWindow = getOrResetWindow(globalWindow, globalWindowMs, now);

  if (currentGlobalWindow.count >= globalLimit) {
    globalWindow = currentGlobalWindow;
    clientWindows.set(clientKey, clientWindow);

    return {
      allowed: false,
      scope: "global",
      limit: globalLimit,
      remaining: 0,
      retryAfterSeconds: secondsUntil(currentGlobalWindow.resetAt, now)
    };
  }

  if (clientWindow.count >= clientLimit) {
    globalWindow = currentGlobalWindow;
    clientWindows.set(clientKey, clientWindow);

    return {
      allowed: false,
      scope: "client",
      limit: clientLimit,
      remaining: 0,
      retryAfterSeconds: secondsUntil(clientWindow.resetAt, now)
    };
  }

  clientWindow.count += 1;
  currentGlobalWindow.count += 1;
  clientWindows.set(clientKey, clientWindow);
  globalWindow = currentGlobalWindow;

  return {
    allowed: true,
    limit: clientLimit,
    remaining: Math.max(0, clientLimit - clientWindow.count),
    retryAfterSeconds: 0
  };
}

function getCachedResult<T>(key: string, now: number): T | null {
  const entry = resultCache.get(key) as CacheEntry<T> | undefined;
  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= now) {
    resultCache.delete(key);
    return null;
  }

  // Refresh insertion order so the bounded cache behaves approximately like an LRU cache.
  resultCache.delete(key);
  resultCache.set(key, entry);
  return entry.value;
}

function setCachedResult<T>(key: string, value: T, now: number) {
  const ttlMs = readPositiveInt("AI_RESULT_CACHE_TTL_MS", DEFAULT_CACHE_TTL_MS);
  const maxEntries = readPositiveInt("AI_RESULT_CACHE_MAX_ENTRIES", DEFAULT_CACHE_MAX_ENTRIES);

  resultCache.set(key, {
    value,
    expiresAt: now + ttlMs
  });

  pruneResultCache(now, maxEntries);
}

export async function runCachedExtraction<T>(
  cacheKey: string,
  loader: () => Promise<T>
): Promise<{ result: T; source: ExtractionCacheSource }> {
  const now = Date.now();
  const cached = getCachedResult<T>(cacheKey, now);
  if (cached !== null) {
    return { result: cached, source: "hit" };
  }

  const active = inFlightExtractions.get(cacheKey) as Promise<T> | undefined;
  if (active) {
    return {
      result: await active,
      source: "coalesced"
    };
  }

  const task = Promise.resolve()
    .then(loader)
    .then((result) => {
      setCachedResult(cacheKey, result, Date.now());
      return result;
    })
    .finally(() => {
      inFlightExtractions.delete(cacheKey);
    });

  inFlightExtractions.set(cacheKey, task);

  return {
    result: await task,
    source: "miss"
  };
}

export function resetAiUsageGuardForTests() {
  clientWindows.clear();
  globalWindow = null;
  resultCache.clear();
  inFlightExtractions.clear();
}
