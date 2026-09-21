import { createHash, timingSafeEqual } from "node:crypto";

type RequestOptions = RequestInit & { expectJson?: boolean };

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
  headers.set("Authorization", `Bearer ${serviceRoleKey}`);
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

export function requestOriginIsAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export function jsonError(error: unknown): Response {
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status: unknown }).status)
    : 500;
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  const message = safeStatus === 403
    ? "تعذّر التحقق من هذا الجهاز. أوقف الإشعارات وفعّلها من جديد."
    : "تعذّر إكمال طلب الإشعارات الآن. جرّب مرة أخرى بعد قليل.";
  if (safeStatus >= 500) console.error("Push API error:", error);
  return Response.json({ error: message }, { status: safeStatus });
}
