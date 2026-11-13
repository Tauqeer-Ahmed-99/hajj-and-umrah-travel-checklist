import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { after } from "next/server";

// An accepted transaction owns the outbox event. A failed transaction cannot notify.
export function dispatchAfterResponse() {
  after(async () => {
    try {
      await (await import("./notification-dispatch")).dispatchNotifications();
    } catch {
      console.warn("Notification dispatch deferred. No delivery is confirmed.");
    }
  });
}
export async function assignmentChanged(
  db: PoolClient,
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
  await db.query(
    `INSERT INTO notification_events (source_key, recipient_id, trip_id, family_id, entry_id, kind)
    SELECT $1, e.responsible_member_id, f.trip_id, f.id, e.id, $5 FROM checklist_entries e JOIN families f ON f.id = e.family_id
    JOIN notification_preferences p ON p.member_id = e.responsible_member_id
    WHERE e.id = $3 AND f.id = $2 AND e.responsible_member_id <> $4 AND e.removed_at IS NULL
      AND CASE WHEN $5 = 'assignments' THEN p.assignments ELSE p.deadlines END
    ON CONFLICT DO NOTHING`,
    [sourceKey, familyId, entryId, actor, kind],
  );
  dispatchAfterResponse();
}
export async function itineraryChanged(
  db: PoolClient,
  actor: string,
  tripId: string,
) {
  await db.query(
    "UPDATE reminders SET needs_review = true, version = version + 1 WHERE trip_id = $1 AND NOT dismissed",
    [tripId],
  );
  await db.query(
    `INSERT INTO notification_events (source_key, recipient_id, trip_id, kind)
    SELECT $1, tm.member_id, tm.trip_id, 'tripChanges' FROM trip_members tm
    JOIN notification_preferences p ON p.member_id = tm.member_id AND p.trip_changes
    WHERE tm.trip_id = $2 AND tm.member_id <> $3`,
    [randomUUID(), tripId, actor],
  );
  dispatchAfterResponse();
}
