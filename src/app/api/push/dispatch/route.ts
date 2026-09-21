import { createHash, timingSafeEqual } from "node:crypto";
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

type BroadcastDelivery = {
  broadcast_id: string;
  device_id: string;
  title: string;
  body: string;
  url: string;
  attempt_count: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type DispatchConfig = { secret_hash: string };

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied) return false;

  const rows = await supabaseRest<DispatchConfig[]>(
    "push_dispatch_config?id=eq.current&select=secret_hash&limit=1"
  );
  const configuredHash = rows[0]?.secret_hash;
  if (!configuredHash) return false;

  const expected = Buffer.from(configuredHash, "hex");
  const actual = createHash("sha256").update(supplied).digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function dispatchReminders(reminders: DueReminder[]) {
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
      await supabaseRest<void>(
        `push_reminders?id=eq.${encodeURIComponent(reminder.id)}&device_id=eq.${encodeURIComponent(reminder.device_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), locked_at: null }),
          expectJson: false
        }
      );
    } catch (error) {
      failed += 1;
      const status = pushErrorStatus(error);
      if (status === 404 || status === 410) {
        await supabaseRest<void>(
          `push_devices?id=eq.${encodeURIComponent(reminder.device_id)}`,
          { method: "DELETE", expectJson: false }
        );
      } else {
        await supabaseRest<void>(
          `push_reminders?id=eq.${encodeURIComponent(reminder.id)}&device_id=eq.${encodeURIComponent(reminder.device_id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: reminder.attempt_count >= 5 ? "failed" : "pending",
              locked_at: null
            }),
            expectJson: false
          }
        );
      }
    }
  }

  return { checked: reminders.length, sent, failed };
}

async function dispatchBroadcasts(deliveries: BroadcastDelivery[]) {
  let sent = 0;
  let failed = 0;

  for (const delivery of deliveries) {
    try {
      await sendDevicePush(delivery, {
        title: delivery.title,
        body: delivery.body,
        url: delivery.url,
        tag: `murattab-broadcast-${delivery.broadcast_id}`
      });
      sent += 1;
      await supabaseRest<void>(
        `push_broadcast_deliveries?broadcast_id=eq.${encodeURIComponent(delivery.broadcast_id)}&device_id=eq.${encodeURIComponent(delivery.device_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString(), locked_at: null }),
          expectJson: false
        }
      );
    } catch (error) {
      failed += 1;
      const status = pushErrorStatus(error);
      if (status === 404 || status === 410) {
        await supabaseRest<void>(
          `push_devices?id=eq.${encodeURIComponent(delivery.device_id)}`,
          { method: "DELETE", expectJson: false }
        );
      } else {
        await supabaseRest<void>(
          `push_broadcast_deliveries?broadcast_id=eq.${encodeURIComponent(delivery.broadcast_id)}&device_id=eq.${encodeURIComponent(delivery.device_id)}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              status: delivery.attempt_count >= 5 ? "failed" : "pending",
              locked_at: null
            }),
            expectJson: false
          }
        );
      }
    }
  }

  return { checked: deliveries.length, sent, failed };
}

export async function POST(request: Request) {
  try {
    if (!await authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const reminders = await supabaseRest<DueReminder[]>("rpc/claim_due_push_reminders", {
      method: "POST",
      body: JSON.stringify({ p_limit: 100 })
    });
    const broadcasts = await supabaseRest<BroadcastDelivery[]>("rpc/claim_push_broadcast_deliveries", {
      method: "POST",
      body: JSON.stringify({ p_limit: 100 })
    });

    const reminderResult = await dispatchReminders(reminders);
    const broadcastResult = await dispatchBroadcasts(broadcasts);

    return Response.json({
      ok: true,
      checked: reminderResult.checked + broadcastResult.checked,
      sent: reminderResult.sent + broadcastResult.sent,
      failed: reminderResult.failed + broadcastResult.failed,
      reminders: reminderResult,
      broadcasts: broadcastResult
    });
  } catch (error) {
    return jsonError(error);
  }
}
