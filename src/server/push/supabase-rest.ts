import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

type RequestOptions = RequestInit & { expectJson?: boolean };

const ADMIN_SESSION_COOKIE = "murattab_admin_session";
const ADMIN_SESSION_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

function requiredEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function supabaseRest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = new Headers(options.headers);
  headers.set("apikey", serviceRoleKey);

  // Modern sb_secret_* keys authenticate through the apikey header.
  // Legacy service_role JWTs still use Authorization: Bearer.
  if (serviceRoleKey.startsWith("sb_secret_")) {
    headers.delete("Authorization");
  } else {
    headers.set("Authorization", `Bearer ${serviceRoleKey}`);
  }

  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...options,
    headers,
    cache: "no-store"
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }

  if (response.status === 204 || options.expectJson === false) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function safeTokenHashMatches(actualHash: string, token: string): boolean {
  const expected = Buffer.from(actualHash, "hex");
  const actual = Buffer.from(hashDeviceToken(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

type StoredDeviceAuth = { id: string; token_hash: string };

export async function authenticatePushDevice(deviceId: string, deviceToken: string): Promise<void> {
  const rows = await supabaseRest<StoredDeviceAuth[]>(
    `push_devices?id=eq.${encodeURIComponent(deviceId)}&select=id,token_hash&limit=1`
  );
  const device = rows[0];
  if (!device || !safeTokenHashMatches(device.token_hash, deviceToken)) {
    const error = new Error("Invalid device credentials");
    Object.assign(error, { status: 403 });
    throw error;
  }
}

export async function grantPushAdminDevice(deviceId: string): Promise<void> {
  await supabaseRest<void>("push_admin_devices", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ device_id: deviceId }),
    expectJson: false
  });
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      const rawValue = rest.join("=");
      try {
        return decodeURIComponent(rawValue);
      } catch {
        return rawValue;
      }
    }
  }
  return null;
}

export async function hasValidPushAdminSession(request: Request): Promise<boolean> {
  const token = readCookie(request, ADMIN_SESSION_COOKIE);
  if (!token || token.length < 32 || token.length > 256) return false;

  const tokenHash = hashDeviceToken(token);
  const now = new Date().toISOString();
  const rows = await supabaseRest<Array<{ token_hash: string }>>(
    `push_admin_sessions?token_hash=eq.${tokenHash}&expires_at=gt.${encodeURIComponent(now)}&select=token_hash&limit=1`
  );
  if (!rows[0]) return false;

  await supabaseRest<void>(
    `push_admin_sessions?token_hash=eq.${tokenHash}`,
    {
      method: "PATCH",
      body: JSON.stringify({ last_used_at: now }),
      expectJson: false
    }
  );
  return true;
}

export async function issuePushAdminSession(deviceId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashDeviceToken(token);
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await supabaseRest<void>("push_admin_sessions", {
    method: "POST",
    body: JSON.stringify({
      token_hash: tokenHash,
      created_from_device_id: deviceId,
      expires_at: expiresAt
    }),
    expectJson: false
  });

  return [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${ADMIN_SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict"
  ].join("; ");
}

export async function authenticatePushAdmin(deviceId: string, deviceToken: string): Promise<void> {
  await authenticatePushDevice(deviceId, deviceToken);
  const rows = await supabaseRest<Array<{ device_id: string }>>(
    `push_admin_devices?device_id=eq.${encodeURIComponent(deviceId)}&select=device_id&limit=1`
  );
  if (!rows[0]) {
    const error = new Error("Push admin device required");
    Object.assign(error, { status: 403, code: "push_admin_required" });
    throw error;
  }
}

export function requestOriginIsAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function jsonError(error: unknown): Response {
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status: unknown }).status)
    : 500;
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  const isAdminError = typeof error === "object" && error && "code" in error
    && (error as { code?: unknown }).code === "push_admin_required";
  const message = safeStatus === 403
    ? (isAdminError ? "هذا الجهاز غير مخوّل بإرسال إشعارات عامة." : "تعذّر التحقق من هذا الجهاز. أوقف الإشعارات وفعّلها من جديد.")
    : "تعذّر إكمال طلب الإشعارات الآن. جرّب مرة أخرى بعد قليل.";
  if (safeStatus >= 500) console.error("Push API error:", error);
  return Response.json({ error: message }, { status: safeStatus });
}
