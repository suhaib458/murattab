import { PushDeviceRequestSchema } from "@/domain/push";
import {
  authenticatePushDevice,
  jsonError,
  requestOriginIsAllowed,
  supabaseRest
} from "@/server/push/supabase-rest";
import { pushErrorStatus, sendDevicePush, type StoredPushSubscription } from "@/server/push/web-push";
import { checkPushRateLimit } from "@/server/push/rate-limit";

export const runtime = "nodejs";

type DeviceRow = StoredPushSubscription & { id: string };

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return Response.json({ error: "طلب غير مسموح." }, { status: 403 });
  const limited = checkPushRateLimit(request, "test", { limit: 5, windowMs: 5 * 60_000 });
  if (limited) return limited;

  try {
    const parsed = PushDeviceRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "بيانات الجهاز غير صالحة." }, { status: 400 });
    const { deviceId, deviceToken } = parsed.data;
    await authenticatePushDevice(deviceId, deviceToken);
    const rows = await supabaseRest<DeviceRow[]>(
      `push_devices?id=eq.${encodeURIComponent(deviceId)}&enabled=eq.true&select=id,endpoint,p256dh,auth&limit=1`
    );
    const device = rows[0];
    if (!device) return Response.json({ error: "هذا الجهاز غير مسجّل للإشعارات." }, { status: 404 });

    try {
      await sendDevicePush(device, {
        title: "إشعارات مرتب جاهزة",
        body: "تمام! رح توصلك تذكيرات المحاضرات على هذا الجهاز.",
        url: "/schedule",
        tag: "murattab-push-test"
      });
    } catch (error) {
      if ([404, 410].includes(pushErrorStatus(error) ?? 0)) {
        await supabaseRest<void>(`push_devices?id=eq.${encodeURIComponent(deviceId)}`, { method: "DELETE", expectJson: false });
      }
      throw error;
    }

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
