import { PushSubscribeRequestSchema } from "@/domain/push";
import {
  hashDeviceToken,
  jsonError,
  requestOriginIsAllowed,
  safeTokenHashMatches,
  supabaseRest
} from "@/server/push/supabase-rest";
import { checkPushRateLimit } from "@/server/push/rate-limit";

export const runtime = "nodejs";

type DeviceRow = { id: string; token_hash: string };

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return Response.json({ error: "طلب غير مسموح." }, { status: 403 });
  const limited = checkPushRateLimit(request, "subscribe", { limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;

  try {
    const parsed = PushSubscribeRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "بيانات الاشتراك غير صالحة." }, { status: 400 });

    const { deviceId, deviceToken, subscription } = parsed.data;
    const existing = await supabaseRest<DeviceRow[]>(
      `push_devices?id=eq.${encodeURIComponent(deviceId)}&select=id,token_hash&limit=1`
    );
    if (existing[0] && !safeTokenHashMatches(existing[0].token_hash, deviceToken)) {
      return Response.json({ error: "تعذّر التحقق من هذا الجهاز." }, { status: 403 });
    }

    const sameEndpoint = await supabaseRest<DeviceRow[]>(
      `push_devices?endpoint=eq.${encodeURIComponent(subscription.endpoint)}&select=id,token_hash&limit=1`
    );
    if (sameEndpoint[0] && sameEndpoint[0].id !== deviceId) {
      await supabaseRest<void>(`push_devices?id=eq.${encodeURIComponent(sameEndpoint[0].id)}`, {
        method: "DELETE",
        expectJson: false
      });
    }

    await supabaseRest<void>("push_devices", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: deviceId,
        token_hash: hashDeviceToken(deviceToken),
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        expiration_time: subscription.expirationTime ?? null,
        enabled: true,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }),
      expectJson: false
    });

    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
