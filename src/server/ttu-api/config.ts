export interface TtuApiConfig {
  enabled: boolean;
  baseUrl: string | null;
  token: string | null;
  authHeader: string;
  authPrefix: string;
  timeoutMs: number;
  cacheTtlMs: number;
  calendarPath: string | null;
  courseCatalogPath: string | null;
  studentSchedulePath: string | null;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function readTtuApiConfig(env: NodeJS.ProcessEnv = process.env): TtuApiConfig {
  return {
    enabled: env.TTU_API_ENABLED?.trim().toLowerCase() === "true",
    baseUrl: clean(env.TTU_API_BASE_URL),
    token: clean(env.TTU_API_TOKEN),
    authHeader: clean(env.TTU_API_AUTH_HEADER) ?? "Authorization",
    authPrefix: env.TTU_API_AUTH_PREFIX === undefined ? "Bearer" : env.TTU_API_AUTH_PREFIX.trim(),
    timeoutMs: positiveInteger(env.TTU_API_TIMEOUT_MS, 5_000),
    cacheTtlMs: positiveInteger(env.TTU_API_CACHE_TTL_MS, 15 * 60_000),
    calendarPath: clean(env.TTU_API_CALENDAR_PATH),
    courseCatalogPath: clean(env.TTU_API_COURSE_CATALOG_PATH),
    studentSchedulePath: clean(env.TTU_API_STUDENT_SCHEDULE_PATH)
  };
}

export function isTtuCalendarApiConfigured(config: TtuApiConfig): boolean {
  return Boolean(config.enabled && config.baseUrl && config.calendarPath);
}
