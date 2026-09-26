import {
  TtuCourseCatalogSchema,
  type TtuCourseCatalog,
  type TtuCourseCatalogEnvelope
} from "@/domain/ttu-api";
import { TtuApiError, fetchTtuApiJson } from "@/server/ttu-api/client";
import {
  isTtuCourseCatalogApiConfigured,
  readTtuApiConfig,
  type TtuApiConfig
} from "@/server/ttu-api/config";

type CatalogCache = {
  expiresAt: number;
  catalog: TtuCourseCatalog;
};

let catalogCache: CatalogCache | null = null;

function extractCatalogCandidates(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object") return [payload];
  const record = payload as Record<string, unknown>;
  return [payload, record.catalog, record.data].filter((candidate) => candidate !== undefined);
}

/**
 * The university's raw field mapping belongs here after TTU publishes its
 * contract. The UI and local schedule model only consume this normalized form.
 */
export function normalizeTtuCourseCatalogPayload(payload: unknown): TtuCourseCatalog {
  for (const candidate of extractCatalogCandidates(payload)) {
    const parsed = TtuCourseCatalogSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }

  throw new TtuApiError(
    "TTU course catalog payload does not match Murattab's normalized schema",
    "HTTP",
    502
  );
}

export async function resolveTtuCourseCatalog(options: {
  config?: TtuApiConfig;
  fetchImpl?: typeof fetch;
  now?: number;
} = {}): Promise<TtuCourseCatalogEnvelope> {
  const config = options.config ?? readTtuApiConfig();
  const now = options.now ?? Date.now();

  if (!isTtuCourseCatalogApiConfigured(config)) {
    throw new TtuApiError("TTU course catalog API is not configured", "CONFIG");
  }

  if (catalogCache && catalogCache.expiresAt > now) {
    return {
      catalog: catalogCache.catalog,
      meta: {
        source: "official-api",
        fetchedAt: new Date().toISOString(),
        apiConfigured: true
      }
    };
  }

  const payload = await fetchTtuApiJson(config, config.courseCatalogPath!, options.fetchImpl);
  const catalog = normalizeTtuCourseCatalogPayload(payload);

  catalogCache = {
    catalog,
    expiresAt: now + config.cacheTtlMs
  };

  return {
    catalog,
    meta: {
      source: "official-api",
      fetchedAt: new Date().toISOString(),
      apiConfigured: true
    }
  };
}

export function resetTtuCourseCatalogCacheForTests(): void {
  catalogCache = null;
}
