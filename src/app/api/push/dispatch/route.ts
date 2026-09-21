import { timingSafeEqual } from "node:crypto";
import { jsonError, supabaseRest } from "@/server/push/supabase-rest";
import { pushErrorStatus, sendDevicePush } from "@/server/push/web-push";

export const runtime = "nodejs";
export const maxDuration = 60;

type DueReminder = {
  id: string;
  device_id: string;
  title: string;
  body: string;
  url: string;
  attempt_count: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function authorized(request: Request): boolean {
  const configured = process.env.PUSH_DISPATCH_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const reminders = await supabaseRest<DueReminder[]>("rpc/claim_due_push_reminders", {
      method: "POST",
      body: JSON.stringify({ p_limit: 100 })
    });

    let sent = 0;
    let failed = 0;
    for (const reminder of reminders) {
      try {
        await sendDevicePush(reminder, {
          title: reminder.title,
          body: reminder.body,
          url: reminder.url,
          tag: reminder.id
        });
        sent += 1;
        await supabaseRest<void>(`push_reminders?id=eq.${encodeURIComponent(reminder.id)}&device_id=eq.${encodeURIComponent(reminder.device_id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), locked_at: null }),
          expectJson: false
        });
      } catch (error) {
        failed += 1;
        const status = pushErrorStatus(error);
        if (status === 404 || status === 410) {
          await supabaseRest<void>(`push_devices?id=eq.${encodeURIComponent(reminder.device_id)}`, { method: "DELETE", expectJson: false });
        } else {
          const attempts = reminder.attempt_count;
          await supabaseRest<void>(`push_reminders?id=eq.${encodeURIComponent(reminder.id)}&device_id=eq.${encodeURIComponent(reminder.device_id)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: attempts >= 5 ? "failed" : "pending", locked_at: null }),
            expectJson: false
          });
        }
      }
    }

    return Response.json({ ok: true, checked: reminders.length, sent, failed });
  } catch (error) {
    return jsonError(error);
  }
}
