import { PushDeviceRequestSchema } from "@/domain/push";
import {
  authenticatePushDevice,
  jsonError,
  requestOriginIsAllowed,
  supabaseRest
} from "@/server/push/supabase-rest";
import { checkPushRateLimit } from "@/server/push/rate-limit";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  if (!requestOriginIsAllowed(request)) return Response.json({ error: "طلب غير مسموح." }, { status: 403 });
  const limited = checkPushRateLimit(request, "device-delete", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  try {
    const parsed = PushDeviceRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "بيانات الجهاز غير صالحة." }, { status: 400 });
    const { deviceId, deviceToken } = parsed.data;
    await authenticatePushDevice(deviceId, deviceToken);
    await supabaseRest<void>(`push_devices?id=eq.${encodeURIComponent(deviceId)}`, {
      method: "DELETE",
      expectJson: false
    });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
