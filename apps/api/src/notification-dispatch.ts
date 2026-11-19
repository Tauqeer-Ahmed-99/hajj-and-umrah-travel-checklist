import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "./database";
import { transaction } from "./trips";
import { permittedEvent, type NotificationScope } from "./notifications";
import { clerkClient } from "./identity";
import { HttpError } from "./response";

const messages = {
  assignments:
    "An important assignment needs your attention. Open Travel Companion.",
  deadlines:
    "A preparation deadline needs your attention. Open Travel Companion.",
  tripChanges:
    "Your trip changed. Review your travel details and reminders in Travel Companion.",
};
type DispatchRow = NotificationScope & {
  kind: keyof typeof messages;
  reminder_id: string | null;
  reminder_version: number | null;
  token: string;
  member_id: string;
  clerk_user_id: string;
  session_id: string;
  enabled: boolean;
  trip_ids: string[];
  assignments: boolean;
  deadlines: boolean;
  tripChanges: boolean;
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
    .execute(sql`INSERT INTO notification_events (source_key, recipient_id, trip_id, family_id, entry_id, reminder_id, reminder_version, kind)
    SELECT 'reminder:' || r.id || ':' || r.version, r.owner_member_id, r.trip_id, r.family_id, r.entry_id, r.id, r.version, 'deadlines'
    FROM reminders r JOIN notification_preferences p ON p.member_id = r.owner_member_id AND p.deadlines
    WHERE NOT r.dismissed AND NOT r.needs_review AND (r.due_at->>'dateTime')::timestamptz <= now() AND (r.transport_step_id IS NULL OR ((r.due_at->>'dateTime')::timestamptz > now()-interval '2 minutes' AND coalesce((SELECT boarding_enabled FROM trip_travel_preferences tp WHERE tp.trip_id=r.trip_id AND tp.member_id=r.owner_member_id),true)))
    ON CONFLICT DO NOTHING`);
  await database()
    .execute(sql`INSERT INTO notification_deliveries (event_id, device_id)
    SELECT e.id, d.id FROM notification_events e JOIN notification_devices d ON d.member_id = e.recipient_id
    WHERE d.enabled AND e.trip_id = ANY(d.trip_ids) AND d.registered_at <= e.created_at AND e.created_at > now() - interval '2 days'
    ON CONFLICT DO NOTHING`);
  // A process crash after claiming may have reached Expo. Never replay it blindly.
  await database().execute(
    sql`UPDATE notification_deliveries SET state = 'unknown', updated_at = clock_timestamp() WHERE state = 'sending' AND updated_at < now() - interval '2 minutes'`,
  );
  const pending = await database().execute(
    sql`SELECT event_id, device_id FROM notification_deliveries WHERE state = 'pending' ORDER BY updated_at LIMIT 10`,
  );
  for (const key of pending.rows) {
    const claimed = await database().execute(
      sql`UPDATE notification_deliveries SET state = 'sending', updated_at = clock_timestamp() WHERE event_id = ${sql.param(key.event_id)} AND device_id = ${sql.param(key.device_id)} AND state = 'pending' RETURNING event_id`,
    );
    if (!claimed.rowCount) continue;
    try {
      await transaction(async (db) => {
        const row = (
          await db.execute<DispatchRow>(sql`SELECT e.*, d.token, d.member_id, d.clerk_user_id, d.session_id, d.enabled, d.trip_ids,
          p.assignments, p.deadlines, p.trip_changes AS "tripChanges"
          FROM notification_events e JOIN notification_devices d ON d.id = ${sql.param(key.device_id)}
          JOIN notification_preferences p ON p.member_id = e.recipient_id
          WHERE e.id = ${sql.param(key.event_id)} FOR UPDATE OF d FOR SHARE OF p`)
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
              await db.execute(
                sql`SELECT id FROM checklist_entries WHERE id = ${sql.param(row.entry_id)} AND responsible_member_id = ${sql.param(row.recipient_id)} AND removed_at IS NULL`,
              )
            ).rowCount,
          );
        }
        let boardingBody: string | undefined;
        if (allowed && row.reminder_id) {
          const current = (
            await db.execute<{
              transport_step_id: string | null;
              mode: string | null;
              transport_offset_minutes: number | null;
            }>(
              sql`SELECT r.transport_step_id,r.transport_offset_minutes,s.mode FROM reminders r LEFT JOIN trip_transport_steps s ON s.id=r.transport_step_id WHERE r.id = ${sql.param(row.reminder_id)} AND r.owner_member_id = ${sql.param(row.recipient_id)} AND r.version = ${sql.param(row.reminder_version)} AND NOT r.dismissed AND NOT r.needs_review
                AND (r.transport_step_id IS NULL OR (s.version=r.transport_step_version AND (r.due_at->>'dateTime')::timestamptz > now()-interval '2 minutes' AND coalesce((SELECT boarding_enabled FROM trip_travel_preferences tp WHERE tp.trip_id=r.trip_id AND tp.member_id=r.owner_member_id),true))) FOR SHARE OF r`,
            )
          ).rows[0];
          allowed = Boolean(current);
          if (current?.transport_step_id)
            boardingBody = (await import("./travel-plan")).boardingLabel(
              current.mode!,
              current.transport_offset_minutes!,
            );
          if (
            (
              await db.execute(
                sql`SELECT 1 FROM notification_local_schedules WHERE device_id = ${sql.param(key.device_id)} AND reminder_id = ${sql.param(row.reminder_id)} AND version = ${sql.param(row.reminder_version)}`,
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
            await db.execute(
              sql`UPDATE notification_devices SET enabled = false WHERE id = ${sql.param(key.device_id)}`,
            );
        }
        if (allowed) {
          // Persisted claim precedes the provider boundary. No transparent HTTP retry.
          try {
            const response = await expo(
              "send",
              {
                to: row.token,
                title: "Travel Companion",
                body:
                  boardingBody ??
                  (row.source_key?.startsWith("family-ready:")
                    ? "A family is packed and ready. Open Travel Companion to see the update."
                    : row.source_key?.startsWith("trip-tip:")
                      ? "A trip member shared a packing tip. Open Travel Companion."
                      : messages[row.kind as keyof typeof messages]),
                channelId: "travel",
                ttl: boardingBody ? 120 : 3600,
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
              await db.execute(
                sql`UPDATE notification_devices SET enabled = false WHERE id = ${sql.param(key.device_id)}`,
              );
          } catch {
            state = "unknown";
          }
        }
        await db.execute(
          sql`UPDATE notification_deliveries SET state = ${sql.param(state)}, ticket_id = ${sql.param(ticketId)}, updated_at = clock_timestamp() WHERE event_id = ${sql.param(key.event_id)} AND device_id = ${sql.param(key.device_id)}`,
        );
      });
    } catch {
      // Authority/provider preflight could not be established. No send occurred
      // unless the transaction failed after the provider call: keep that uncertain.
      await database().execute(
        sql`UPDATE notification_deliveries SET state = 'unknown', updated_at = clock_timestamp() WHERE event_id = ${sql.param(key.event_id)} AND device_id = ${sql.param(key.device_id)} AND state = 'sending'`,
      );
    }
  }
  const submitted = await database().execute<{
    event_id: string;
    device_id: string;
    ticket_id: string;
  }>(
    sql`SELECT event_id, device_id, ticket_id FROM notification_deliveries WHERE state = 'submitted' ORDER BY updated_at LIMIT 100`,
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
        await database().execute(
          sql`UPDATE notification_deliveries SET state = ${sql.param(result.data.status === "ok" ? "provider_accepted" : "failed")}, updated_at = clock_timestamp() WHERE event_id = ${sql.param(row.event_id)} AND device_id = ${sql.param(row.device_id)} AND state = 'submitted'`,
        );
        if (result.data.details?.error === "DeviceNotRegistered")
          await database().execute(
            sql`UPDATE notification_devices SET enabled = false WHERE id = ${sql.param(row.device_id)}`,
          );
      }
    } catch {
      /* Receipt reads are safe to repeat; submitted is not delivered. */
    }
  }
  // Expo retains receipts for about 24 hours. A missed receipt is uncertainty,
  // never evidence of device delivery and never a reason to send again.
  await database().execute(
    sql`UPDATE notification_deliveries SET state = 'unknown', updated_at = clock_timestamp() WHERE state = 'submitted' AND updated_at < now() - interval '24 hours'`,
  );
  const remaining = await database().execute(
    sql`SELECT 1 FROM notification_deliveries WHERE state='pending' LIMIT 1`,
  );
  return { status: "processed", morePending: Boolean(remaining.rowCount) };
}

// Drain subsequent batches after the response so a trip with more than ten
// devices does not wait for the daily fallback job. Claims and fresh permission
// checks still happen separately for every delivery; uncertain sends never replay.
export async function dispatchPendingNotifications() {
  const until = Date.now() + 45_000;
  do {
    const result = await dispatchNotifications();
    if (!("morePending" in result) || !result.morePending) return;
  } while (Date.now() < until);
}
