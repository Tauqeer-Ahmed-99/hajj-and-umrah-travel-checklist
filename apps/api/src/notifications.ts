import { eq, sql } from "drizzle-orm";
import { notificationPreferences } from "./schema";
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
import type { DatabaseTransaction } from "./database";
import { lockAccountAccess, requireActiveMember } from "./account-access";

export const preferenceColumns = `assignments, deadlines, trip_changes AS "tripChanges"`;
export type NotificationScope = {
  recipient_id: string;
  trip_id: string;
  family_id: string | null;
  entry_id: string | null;
};
export async function permittedEvent(
  db: DatabaseTransaction,
  row: NotificationScope,
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
    await db.execute<{
      audience: string;
    }>(sql`SELECT e.audience FROM checklist_entries e JOIN families f ON f.id = e.family_id
       WHERE e.id = ${sql.param(row.entry_id)} AND e.family_id = ${sql.param(row.family_id)} AND f.trip_id = ${sql.param(row.trip_id)} AND e.removed_at IS NULL FOR SHARE OF e`)
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
      await db.execute<NotificationPreferences>(
        sql`SELECT ${sql.raw(preferenceColumns)} FROM notification_preferences WHERE member_id = ${sql.param(actor)}`,
      )
    ).rows[0] ?? { assignments: false, deadlines: false, tripChanges: false };
    const result = await db.execute<
      NotificationScope & { kind: string; state: string }
    >(
      sql`SELECT e.*, d.state FROM notification_events e JOIN notification_deliveries d ON d.event_id = e.id WHERE e.recipient_id = ${sql.param(actor)} ORDER BY e.created_at DESC LIMIT 30`,
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
    await db.execute(
      sql`INSERT INTO notification_preferences (member_id) VALUES (${sql.param(actor)}) ON CONFLICT DO NOTHING`,
    );
    const [preferences] = await db
      .update(notificationPreferences)
      .set(input)
      .where(eq(notificationPreferences.memberId, actor))
      .returning({
        assignments: notificationPreferences.assignments,
        deadlines: notificationPreferences.deadlines,
        tripChanges: notificationPreferences.tripChanges,
      });
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
        await db.execute<NotificationScope>(
          sql`SELECT owner_member_id AS recipient_id, trip_id, family_id, entry_id FROM reminders WHERE id = ${sql.param(schedule.id)} AND owner_member_id = ${sql.param(identity.id)}`,
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
    await db.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${sql.param(input.token)}))`,
    );
    const old = await db.execute(
      sql`SELECT id, member_id, session_id, token FROM notification_devices WHERE id = ${sql.param(input.deviceId)} OR token = ${sql.param(input.token)} FOR UPDATE`,
    );
    for (const device of old.rows) {
      if (
        device.member_id !== identity.id ||
        device.session_id !== identity.sessionId ||
        device.token !== input.token ||
        device.id !== input.deviceId
      )
        await db.execute(
          sql`DELETE FROM notification_devices WHERE id = ${sql.param(device.id)}`,
        );
    }
    await db.execute(sql`INSERT INTO notification_devices (id, member_id, clerk_user_id, session_id, token, trip_ids) VALUES (${sql.param(input.deviceId)},${sql.param(identity.id)},${sql.param(identity.clerkUserId)},${sql.param(identity.sessionId)},${sql.param(input.token)},${sql.param(input.tripIds)})
      ON CONFLICT (id) DO UPDATE SET trip_ids = EXCLUDED.trip_ids, enabled = true`);
    for (const schedule of input.localSchedules)
      await db.execute(sql`INSERT INTO notification_local_schedules (device_id, reminder_id, version) VALUES (${sql.param(input.deviceId)},${sql.param(schedule.id)},${sql.param(schedule.version)})
      ON CONFLICT (device_id, reminder_id) DO UPDATE SET version = GREATEST(notification_local_schedules.version, EXCLUDED.version)`);
    return { saved: true };
  });
}
export function removeDevice(actor: string, id: string) {
  resourceId(id);
  return transaction(async (db) => {
    await db.execute(
      sql`DELETE FROM notification_devices WHERE id = ${sql.param(id)} AND member_id = ${sql.param(actor)}`,
    );
    return { saved: true };
  });
}
