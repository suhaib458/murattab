import { PushBroadcastRequestSchema } from "@/domain/push";
import { checkPushRateLimit } from "@/server/push/rate-limit";
import {
  authenticatePushAdmin,
  jsonError,
  requestOriginIsAllowed,
  supabaseRest
} from "@/server/push/supabase-rest";

export const runtime = "nodejs";

type CreateBroadcastResult = {
  broadcast_id: string;
  queued: number;
};

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) return Response.json({ error: "طلب غير مسموح." }, { status: 403 });
  const limited = checkPushRateLimit(request, "admin-broadcast", { limit: 10, windowMs: 60 * 60_000 });
  if (limited) return limited;

  try {
    const parsed = PushBroadcastRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "تحقق من عنوان الإشعار ونصه ثم جرّب مرة أخرى." }, { status: 400 });
    }

    const { deviceId, deviceToken, title, body, url } = parsed.data;
    await authenticatePushAdmin(deviceId, deviceToken);

    const rows = await supabaseRest<CreateBroadcastResult[]>("rpc/create_push_broadcast", {
      method: "POST",
      body: JSON.stringify({
        p_admin_device_id: deviceId,
        p_title: title,
        p_body: body,
        p_url: url
      })
    });

    const created = rows[0];
    if (!created) throw new Error("Broadcast was not created");

    return Response.json({
      ok: true,
      broadcastId: created.broadcast_id,
      queued: created.queued
    });
  } catch (error) {
    return jsonError(error);
  }
}
