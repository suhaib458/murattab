import { PushDeviceRequestSchema } from "@/domain/push";
import { checkPushRateLimit } from "@/server/push/rate-limit";
import {
  authenticatePushDevice,
  grantPushAdminDevice,
  hasValidPushAdminSession,
  issuePushAdminSession,
  requestOriginIsAllowed,
  supabaseRest
} from "@/server/push/supabase-rest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return Response.json({ admin: false }, { status: 403 });
  const limited = checkPushRateLimit(request, "admin-status", { limit: 30, windowMs: 5 * 60_000 });
  if (limited) return limited;

  try {
    const parsed = PushDeviceRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ admin: false }, { status: 400 });

    const { deviceId, deviceToken } = parsed.data;
    await authenticatePushDevice(deviceId, deviceToken);

    let rows = await supabaseRest<Array<{ device_id: string }>>(
      `push_admin_devices?device_id=eq.${encodeURIComponent(deviceId)}&select=device_id&limit=1`
    );
    let admin = Boolean(rows[0]);
    const hasAdminSession = await hasValidPushAdminSession(request);

    if (!admin && hasAdminSession) {
      await grantPushAdminDevice(deviceId);
      rows = [{ device_id: deviceId }];
      admin = true;
    }

    if (!admin) return Response.json({ admin: false });

    if (hasAdminSession) return Response.json({ admin: true });

    const cookie = await issuePushAdminSession(deviceId);
    return Response.json(
      { admin: true },
      { headers: { "Set-Cookie": cookie } }
    );
  } catch {
    return Response.json({ admin: false });
  }
}
