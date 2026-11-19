import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "./database";
import { randomUUID } from "node:crypto";
import { after } from "next/server";

// An accepted transaction owns the outbox event. A failed transaction cannot notify.
export function dispatchAfterResponse() {
  after(async () => {
    try {
      await (
        await import("./notification-dispatch")
      ).dispatchPendingNotifications();
    } catch {
      console.warn("Notification dispatch deferred. No delivery is confirmed.");
    }
  });
}
export async function assignmentChanged(
  db: DatabaseTransaction,
  actor: string,
  familyId: string,
  entryId: string,
  sourceKey: string,
  changes: Record<string, unknown>,
) {
  const kind = changes.responsibleMemberId
    ? "assignments"
    : changes.dueDate || changes.expectedDeliveryDate
      ? "deadlines"
      : null;
  if (!kind) return;
  await db.execute(sql`INSERT INTO notification_events (source_key, recipient_id, trip_id, family_id, entry_id, kind)
    SELECT ${sql.param(sourceKey)}, e.responsible_member_id, f.trip_id, f.id, e.id, ${sql.param(kind)} FROM checklist_entries e JOIN families f ON f.id = e.family_id
    JOIN notification_preferences p ON p.member_id = e.responsible_member_id
    WHERE e.id = ${sql.param(entryId)} AND f.id = ${sql.param(familyId)} AND e.responsible_member_id <> ${sql.param(actor)} AND e.removed_at IS NULL
      AND CASE WHEN ${sql.param(kind)} = 'assignments' THEN p.assignments ELSE p.deadlines END
    ON CONFLICT DO NOTHING`);
  dispatchAfterResponse();
}
export async function itineraryChanged(
  db: DatabaseTransaction,
  actor: string,
  tripId: string,
) {
  await db.execute(
    sql`UPDATE reminders SET needs_review = true, version = version + 1 WHERE trip_id = ${sql.param(tripId)} AND NOT dismissed AND transport_step_id IS NULL`,
  );
  await db.execute(sql`INSERT INTO notification_events (source_key, recipient_id, trip_id, kind)
    SELECT ${sql.param(randomUUID())}, tm.member_id, tm.trip_id, 'tripChanges' FROM trip_members tm
    JOIN notification_preferences p ON p.member_id = tm.member_id AND p.trip_changes
    WHERE tm.trip_id = ${sql.param(tripId)} AND tm.member_id <> ${sql.param(actor)}`);
  dispatchAfterResponse();
}
