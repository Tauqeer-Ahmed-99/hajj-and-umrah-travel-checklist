import type {
  NotificationDeviceInput,
  NotificationPreferences,
} from "@nmt/contracts";
import { transaction } from "./trips";
import {
  requireTripAccess,
  requireFamilyAccess,
  resourceId,
} from "./permissions";
import { HttpError } from "./response";
import type { PoolClient } from "pg";
import { lockAccountAccess, requireActiveMember } from "./account-access";

export const preferenceColumns = `assignments, deadlines, trip_changes AS "tripChanges"`;
export async function permittedEvent(
  db: PoolClient,
  row: {
    recipient_id: string;
    trip_id: string;
    family_id: string | null;
    entry_id: string | null;
  },
) {
  await requireTripAccess(db, row.recipient_id, row.trip_id);
  let familyAccess = false;
  if (row.family_id) {
    try {
      await requireFamilyAccess(
        db,
        row.recipient_id,
        row.trip_id,
        row.family_id,
      );
      familyAccess = true;
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404 && row.entry_id))
        throw error;
    }
  }
  if (!row.entry_id) return;
  // Preserve membership -> family grant -> entry lock order. The exact current
  // item, including its audience, stays locked through dispatch; an old event's
  // owning family is attribution, not an additional grant for trip-shared items.
  const entry = (
    await db.query<{ audience: string }>(
      `SELECT e.audience FROM checklist_entries e JOIN families f ON f.id = e.family_id
       WHERE e.id = $1 AND e.family_id = $2 AND f.trip_id = $3 AND e.removed_at IS NULL FOR SHARE OF e`,
      [row.entry_id, row.family_id, row.trip_id],
    )
  ).rows[0];
  if (!entry || (!familyAccess && entry.audience !== "trip"))
    throw new HttpError(
      404,
      "not_found",
      "This reference is no longer available.",
    );
}
export function readNotifications(actor: string) {
  return transaction(async (db) => {
    await requireActiveMember(db, actor);
    const preferences = (
      await db.query<NotificationPreferences>(
        `SELECT ${preferenceColumns} FROM notification_preferences WHERE member_id = $1`,
        [actor],
      )
    ).rows[0] ?? { assignments: false, deadlines: false, tripChanges: false };
    const result = await db.query(
      `SELECT e.*, d.state FROM notification_events e JOIN notification_deliveries d ON d.event_id = e.id WHERE e.recipient_id = $1 ORDER BY e.created_at DESC LIMIT 30`,
      [actor],
    );
    const deliveries: { kind: string; state: string }[] = [];
    for (const row of result.rows) {
      try {
        await permittedEvent(db, row);
        deliveries.push({ kind: row.kind, state: row.state });
      } catch (error) {
        if (!(error instanceof HttpError && [403, 404].includes(error.status)))
          throw error;
      }
    }
    return { preferences, deliveries };
  });
}
export function patchNotifications(
  actor: string,
  input: Partial<NotificationPreferences>,
) {
  return transaction(async (db) => {
    await requireActiveMember(db, actor);
    await db.query(
      "INSERT INTO notification_preferences (member_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [actor],
    );
    const names = {
      assignments: "assignments",
      deadlines: "deadlines",
      tripChanges: "trip_changes",
    };
    const keys = Object.keys(input) as (keyof NotificationPreferences)[];
    const preferences = (
      await db.query<NotificationPreferences>(
        `UPDATE notification_preferences SET ${keys.map((key, i) => `${names[key]} = $${i + 2}`).join(", ")} WHERE member_id = $1 RETURNING ${preferenceColumns}`,
        [actor, ...keys.map((key) => input[key])],
      )
    ).rows[0];
    return { preferences, deliveries: [] };
  });
}
export function registerDevice(
  identity: { id: string; clerkUserId: string; sessionId: string },
  input: NotificationDeviceInput,
) {
  return transaction(async (db) => {
    await lockAccountAccess(db);
    await requireActiveMember(db, identity.id);
    for (const tripId of input.tripIds)
      await requireTripAccess(db, identity.id, tripId);
    for (const schedule of input.localSchedules) {
      const row = (
        await db.query(
          "SELECT owner_member_id AS recipient_id, trip_id, family_id, entry_id FROM reminders WHERE id = $1 AND owner_member_id = $2",
          [schedule.id, identity.id],
        )
      ).rows[0];
      if (!row)
        throw new HttpError(
          404,
          "not_found",
          "Refresh your reminders before enabling notifications.",
        );
      await permittedEvent(db, row);
    }
    // A device/token can belong only to its current verified session. Old jobs
    // are removed rather than reassigned when accounts or sessions change.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.token]);
    const old = await db.query(
      "SELECT id, member_id, session_id, token FROM notification_devices WHERE id = $1 OR token = $2 FOR UPDATE",
      [input.deviceId, input.token],
    );
    for (const device of old.rows) {
      if (
        device.member_id !== identity.id ||
        device.session_id !== identity.sessionId ||
        device.token !== input.token ||
        device.id !== input.deviceId
      )
        await db.query("DELETE FROM notification_devices WHERE id = $1", [
          device.id,
        ]);
    }
    await db.query(
      `INSERT INTO notification_devices (id, member_id, clerk_user_id, session_id, token, trip_ids) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET trip_ids = EXCLUDED.trip_ids, enabled = true`,
      [
        input.deviceId,
        identity.id,
        identity.clerkUserId,
        identity.sessionId,
        input.token,
        input.tripIds,
      ],
    );
    for (const schedule of input.localSchedules)
      await db.query(
        `INSERT INTO notification_local_schedules (device_id, reminder_id, version) VALUES ($1,$2,$3)
      ON CONFLICT (device_id, reminder_id) DO UPDATE SET version = GREATEST(notification_local_schedules.version, EXCLUDED.version)`,
        [input.deviceId, schedule.id, schedule.version],
      );
    return { saved: true };
  });
}
export function removeDevice(actor: string, id: string) {
  resourceId(id);
  return transaction(async (db) => {
    await db.query(
      "DELETE FROM notification_devices WHERE id = $1 AND member_id = $2",
      [id, actor],
    );
    return { saved: true };
  });
}
