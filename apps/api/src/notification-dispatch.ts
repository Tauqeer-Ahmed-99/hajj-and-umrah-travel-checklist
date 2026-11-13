import { z } from "zod";
import { database } from "./database";
import { transaction } from "./trips";
import { permittedEvent } from "./notifications";
import { clerkClient } from "./identity";
import { HttpError } from "./response";

const messages = {
  assignments: "An important assignment needs your attention. Open NMT Travel.",
  deadlines: "A preparation deadline needs your attention. Open NMT Travel.",
  tripChanges:
    "Your trip changed. Review your travel details and reminders in NMT Travel.",
};
const ticket = z.object({
  status: z.enum(["ok", "error"]),
  id: z.string().optional(),
  details: z.object({ error: z.string().optional() }).optional(),
});
async function expo(path: string, body: unknown, accessToken: string) {
  const base =
    process.env.NODE_ENV !== "production" && process.env.EXPO_PUSH_API_URL
      ? process.env.EXPO_PUSH_API_URL
      : "https://exp.host/--/api/v2/push";
  const response = await fetch(`${base}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok)
    throw new Error("Notification provider outcome unconfirmed");
  return response.json();
}

export async function dispatchNotifications() {
  // Optional provider validation belongs here, never in a build or unrelated route.
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  if (!accessToken) return { status: "disabled" };
  await database()
    .query(`INSERT INTO notification_events (source_key, recipient_id, trip_id, family_id, entry_id, reminder_id, reminder_version, kind)
    SELECT 'reminder:' || r.id || ':' || r.version, r.owner_member_id, r.trip_id, r.family_id, r.entry_id, r.id, r.version, 'deadlines'
    FROM reminders r JOIN notification_preferences p ON p.member_id = r.owner_member_id AND p.deadlines
    WHERE NOT r.dismissed AND NOT r.needs_review AND (r.due_at->>'dateTime')::timestamptz <= now()
    ON CONFLICT DO NOTHING`);
  await database()
    .query(`INSERT INTO notification_deliveries (event_id, device_id)
    SELECT e.id, d.id FROM notification_events e JOIN notification_devices d ON d.member_id = e.recipient_id
    WHERE d.enabled AND e.trip_id = ANY(d.trip_ids) AND d.registered_at <= e.created_at AND e.created_at > now() - interval '2 days'
    ON CONFLICT DO NOTHING`);
  // A process crash after claiming may have reached Expo. Never replay it blindly.
  await database().query(
    "UPDATE notification_deliveries SET state = 'unknown', updated_at = clock_timestamp() WHERE state = 'sending' AND updated_at < now() - interval '2 minutes'",
  );
  const pending = await database().query(
    `SELECT event_id, device_id FROM notification_deliveries WHERE state = 'pending' ORDER BY updated_at LIMIT 10`,
  );
  for (const key of pending.rows) {
    const claimed = await database().query(
      `UPDATE notification_deliveries SET state = 'sending', updated_at = clock_timestamp() WHERE event_id = $1 AND device_id = $2 AND state = 'pending' RETURNING event_id`,
      [key.event_id, key.device_id],
    );
    if (!claimed.rowCount) continue;
    try {
      await transaction(async (db) => {
        const row = (
          await db.query(
            `SELECT e.*, d.token, d.member_id, d.clerk_user_id, d.session_id, d.enabled, d.trip_ids,
          p.assignments, p.deadlines, p.trip_changes AS "tripChanges"
          FROM notification_events e JOIN notification_devices d ON d.id = $2
          JOIN notification_preferences p ON p.member_id = e.recipient_id
          WHERE e.id = $1 FOR UPDATE OF d FOR SHARE OF p`,
            [key.event_id, key.device_id],
          )
        ).rows[0];
        let state = "suppressed";
        let ticketId: string | null = null;
        let allowed = Boolean(
          row?.enabled &&
          row.member_id === row.recipient_id &&
          row[row.kind] &&
          row.trip_ids.includes(row.trip_id),
        );
        if (allowed) {
          try {
            await permittedEvent(db, row);
          } catch (error) {
            if (error instanceof HttpError && [403, 404].includes(error.status))
              allowed = false;
            else throw error;
          }
        }
        if (allowed && row.entry_id && !row.reminder_id) {
          allowed = Boolean(
            (
              await db.query(
                "SELECT id FROM checklist_entries WHERE id = $1 AND responsible_member_id = $2 AND removed_at IS NULL",
                [row.entry_id, row.recipient_id],
              )
            ).rowCount,
          );
        }
        if (allowed && row.reminder_id) {
          allowed = Boolean(
            (
              await db.query(
                "SELECT id FROM reminders WHERE id = $1 AND owner_member_id = $2 AND version = $3 AND NOT dismissed AND NOT needs_review FOR SHARE",
                [row.reminder_id, row.recipient_id, row.reminder_version],
              )
            ).rowCount,
          );
          if (
            (
              await db.query(
                "SELECT 1 FROM notification_local_schedules WHERE device_id = $1 AND reminder_id = $2 AND version = $3",
                [key.device_id, row.reminder_id, row.reminder_version],
              )
            ).rowCount
          )
            allowed = false;
        }
        if (allowed) {
          const client = clerkClient();
          const [session, user] = await Promise.all([
            client.sessions.getSession(row.session_id),
            client.users.getUser(row.clerk_user_id),
          ]);
          allowed =
            session.status === "active" &&
            session.userId === row.clerk_user_id &&
            !user.banned &&
            !user.locked;
          if (!allowed)
            await db.query(
              "UPDATE notification_devices SET enabled = false WHERE id = $1",
              [key.device_id],
            );
        }
        if (allowed) {
          // Persisted claim precedes the provider boundary. No transparent HTTP retry.
          try {
            const response = await expo(
              "send",
              {
                to: row.token,
                title: "NMT Travel",
                body: messages[row.kind as keyof typeof messages],
                channelId: "travel",
                ttl: 3600,
              },
              accessToken,
            );
            const result = ticket.parse(response.data);
            if (result.status === "ok" && !result.id)
              throw new Error("Unconfirmed push ticket");
            state =
              result.status === "ok" && result.id ? "submitted" : "failed";
            ticketId = result.id ?? null;
            if (result.details?.error === "DeviceNotRegistered")
              await db.query(
                "UPDATE notification_devices SET enabled = false WHERE id = $1",
                [key.device_id],
              );
          } catch {
            state = "unknown";
          }
        }
        await db.query(
          "UPDATE notification_deliveries SET state = $3, ticket_id = $4, updated_at = clock_timestamp() WHERE event_id = $1 AND device_id = $2",
          [key.event_id, key.device_id, state, ticketId],
        );
      });
    } catch {
      // Authority/provider preflight could not be established. No send occurred
      // unless the transaction failed after the provider call: keep that uncertain.
      await database().query(
        "UPDATE notification_deliveries SET state = 'unknown', updated_at = clock_timestamp() WHERE event_id = $1 AND device_id = $2 AND state = 'sending'",
        [key.event_id, key.device_id],
      );
    }
  }
  const submitted = await database().query(
    "SELECT event_id, device_id, ticket_id FROM notification_deliveries WHERE state = 'submitted' ORDER BY updated_at LIMIT 100",
  );
  if (submitted.rowCount) {
    try {
      const receipts = await expo(
        "getReceipts",
        { ids: submitted.rows.map((row) => row.ticket_id) },
        accessToken,
      );
      for (const row of submitted.rows) {
        const result = ticket.safeParse(receipts.data?.[row.ticket_id]);
        if (!result.success) continue;
        await database().query(
          "UPDATE notification_deliveries SET state = $3, updated_at = clock_timestamp() WHERE event_id = $1 AND device_id = $2 AND state = 'submitted'",
          [
            row.event_id,
            row.device_id,
            result.data.status === "ok" ? "provider_accepted" : "failed",
          ],
        );
        if (result.data.details?.error === "DeviceNotRegistered")
          await database().query(
            "UPDATE notification_devices SET enabled = false WHERE id = $1",
            [row.device_id],
          );
      }
    } catch {
      /* Receipt reads are safe to repeat; submitted is not delivered. */
    }
  }
  // Expo retains receipts for about 24 hours. A missed receipt is uncertainty,
  // never evidence of device delivery and never a reason to send again.
  await database().query(
    "UPDATE notification_deliveries SET state = 'unknown', updated_at = clock_timestamp() WHERE state = 'submitted' AND updated_at < now() - interval '24 hours'",
  );
  return { status: "processed" };
}
