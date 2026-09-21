import { PushDeviceRequestSchema } from "@/domain/push";
import { checkPushRateLimit } from "@/server/push/rate-limit";
import {
  authenticatePushDevice,
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
    const rows = await supabaseRest<Array<{ device_id: string }>>(
      `push_admin_devices?device_id=eq.${encodeURIComponent(deviceId)}&select=device_id&limit=1`
    );
    return Response.json({ admin: Boolean(rows[0]) });
  } catch {
    return Response.json({ admin: false });
  }
}
