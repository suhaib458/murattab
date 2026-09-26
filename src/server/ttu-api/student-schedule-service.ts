import {
  TtuStudentScheduleSchema,
  type TtuStudentSchedule,
  type TtuStudentScheduleEnvelope
} from "@/domain/ttu-api";
import {
  TtuApiError,
  fetchTtuApiJsonWithCredential
} from "@/server/ttu-api/client";
import {
  isTtuStudentScheduleApiConfigured,
  readTtuApiConfig,
  type TtuApiConfig
} from "@/server/ttu-api/config";

function extractScheduleCandidates(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [payload];
  const record = payload as Record<string, unknown>;
  return [payload, record.schedule, record.data].filter((candidate) => candidate !== undefined);
}

/**
 * Student identity is intentionally not part of Murattab's normalized response.
 * If TTU sends names, IDs, balances, grades, or other fields, Zod strips them.
 */
export function normalizeTtuStudentSchedulePayload(payload: unknown): TtuStudentSchedule {
  for (const candidate of extractScheduleCandidates(payload)) {
    const parsed = TtuStudentScheduleSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }

  throw new TtuApiError(
    "TTU student schedule payload does not match Murattab's normalized schema",
    "HTTP",
    502
  );
}

export async function resolveTtuStudentSchedule(
  delegatedBearerToken: string,
  options: {
    config?: TtuApiConfig;
    fetchImpl?: typeof fetch;
  } = {}
): Promise<TtuStudentScheduleEnvelope> {
  const config = options.config ?? readTtuApiConfig();

  if (!isTtuStudentScheduleApiConfigured(config)) {
    throw new TtuApiError("TTU student schedule API is not configured", "CONFIG");
  }

  const token = delegatedBearerToken.trim();
  if (!token) {
    throw new TtuApiError("A delegated TTU bearer token is required", "CONFIG");
  }

  const payload = await fetchTtuApiJsonWithCredential(
    config,
    config.studentSchedulePath!,
    {
      token,
      header: "Authorization",
      prefix: "Bearer"
    },
    options.fetchImpl
  );

  const schedule = normalizeTtuStudentSchedulePayload(payload);

  return {
    schedule,
    meta: {
      source: "official-api",
      fetchedAt: new Date().toISOString(),
      apiConfigured: true,
      authMode: "delegated-bearer"
    }
  };
}
