import { PushSyncRequestSchema } from "@/domain/push";
import {
  authenticatePushDevice,
  jsonError,
  requestOriginIsAllowed,
  supabaseRest
} from "@/server/push/supabase-rest";
import { checkPushRateLimit } from "@/server/push/rate-limit";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  if (!requestOriginIsAllowed(request)) return Response.json({ error: "طلب غير مسموح." }, { status: 403 });
  const limited = checkPushRateLimit(request, "reminders", { limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;

  try {
    const parsed = PushSyncRequestSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "بيانات التذكيرات غير صالحة." }, { status: 400 });
    const { deviceId, deviceToken, reminders } = parsed.data;
    await authenticatePushDevice(deviceId, deviceToken);

    await supabaseRest<void>("rpc/replace_push_reminders", {
      method: "POST",
      body: JSON.stringify({
        p_device_id: deviceId,
        p_reminders: reminders.map((reminder) => ({
          id: reminder.id,
          due_at: reminder.dueAt,
          title: reminder.title,
          body: reminder.body,
          url: reminder.url
        }))
      }),
      expectJson: false
    });

    return Response.json({ ok: true, count: reminders.length });
  } catch (error) {
    return jsonError(error);
  }
}
