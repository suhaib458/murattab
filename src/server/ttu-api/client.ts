import type { TtuApiConfig } from "@/server/ttu-api/config";

export class TtuApiError extends Error {
  constructor(
    message: string,
    readonly code: "CONFIG" | "TIMEOUT" | "HTTP" | "NETWORK" | "INVALID_URL",
    readonly status?: number
  ) {
    super(message);
    this.name = "TtuApiError";
  }
}

export interface TtuApiCredentialOverride {
  token: string;
  header?: string;
  prefix?: string;
}

function resolveApiUrl(config: TtuApiConfig, path: string): URL {
  if (!config.baseUrl) throw new TtuApiError("TTU API base URL is missing", "CONFIG");

  let base: URL;
  let resolved: URL;
  try {
    const normalizedBase = config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
    base = new URL(normalizedBase);
    resolved = new URL(path, base);
  } catch {
    throw new TtuApiError("TTU API URL configuration is invalid", "INVALID_URL");
  }

  const localDevelopmentHost = base.hostname === "localhost" || base.hostname === "127.0.0.1";
  if (base.protocol !== "https:" && !localDevelopmentHost) {
    throw new TtuApiError("TTU API base URL must use HTTPS", "INVALID_URL");
  }

  if (resolved.origin !== base.origin) {
    throw new TtuApiError("TTU API resource must stay on the configured API origin", "INVALID_URL");
  }

  return resolved;
}

async function requestTtuApiJson(
  config: TtuApiConfig,
  path: string,
  fetchImpl: typeof fetch,
  credentialOverride?: TtuApiCredentialOverride
): Promise<unknown> {
  const url = resolveApiUrl(config, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  const headers = new Headers({ Accept: "application/json" });

  const token = credentialOverride?.token ?? config.token;
  if (token) {
    const header = credentialOverride?.header ?? config.authHeader;
    const prefix = credentialOverride?.prefix ?? config.authPrefix;
    const value = prefix ? `${prefix} ${token}` : token;
    headers.set(header, value);
  }

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers,
      signal: controller.signal,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new TtuApiError(
        `TTU API request failed with status ${response.status}`,
        "HTTP",
        response.status
      );
    }

    return await response.json();
  } catch (error) {
    if (error instanceof TtuApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TtuApiError("TTU API request timed out", "TIMEOUT");
    }
    throw new TtuApiError("TTU API request failed", "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTtuApiJson(
  config: TtuApiConfig,
  path: string,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  return requestTtuApiJson(config, path, fetchImpl);
}

export async function fetchTtuApiJsonWithCredential(
  config: TtuApiConfig,
  path: string,
  credential: TtuApiCredentialOverride,
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  return requestTtuApiJson(config, path, fetchImpl, credential);
}
