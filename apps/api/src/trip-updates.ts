import { and, desc, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import type { TripTipInput, TripTipPatch } from "@nmt/contracts";
import type { DatabaseTransaction } from "./database";
import { tripTips } from "./schema";
import { transaction, createOnce } from "./trips";
import { requireTripAccess, resourceId } from "./permissions";
import { HttpError } from "./response";
import { dispatchAfterResponse } from "./notification-events";

// Derive only a yes/no signal; this projection never returns private contents.
export async function familyIsReady(
  db: DatabaseTransaction,
  familyId: string,
  leg: string,
) {
  const result = await db.execute<{ ready: boolean }>(sql`SELECT
 EXISTS(SELECT 1 FROM packing_allocations WHERE family_id=${familyId} AND leg=${leg})
 AND NOT EXISTS(SELECT 1 FROM checklist_entries e LEFT JOIN return_items r ON r.entry_id=e.id
  WHERE e.family_id=${familyId} AND e.removed_at IS NULL AND e.kind='item' AND e.not_needed_reason IS NULL
  AND (CASE WHEN ${leg}='outbound' THEN e.leg IN ('outbound','both') ELSE (r.entry_id IS NOT NULL OR e.leg IN ('return','both')) END)
  AND (CASE WHEN ${leg}='outbound' THEN e.required_quantity ELSE coalesce(r.required_quantity,e.required_quantity) END >
   coalesce((SELECT sum(a.quantity) FROM packing_allocations a WHERE a.family_id=e.family_id AND a.entry_id=e.id AND a.leg=${leg}),0)
   OR CASE WHEN ${leg}='outbound' THEN e.bought+e.received+e.already_available < e.required_quantity ELSE r.reviewed_at IS NULL OR r.possession_quantity<r.required_quantity END))
 AND NOT EXISTS(SELECT 1 FROM checklist_entries e WHERE e.family_id=${familyId} AND e.removed_at IS NULL AND e.kind='task' AND e.leg IN (${leg},'both') AND e.task_status NOT IN ('done','not_needed'))
 AND NOT EXISTS(SELECT 1 FROM bags b JOIN bag_legs bl ON bl.bag_id=b.id AND bl.leg=${leg}
  WHERE b.removed_at IS NULL AND (b.family_id=${familyId} OR EXISTS(SELECT 1 FROM packing_allocations a WHERE a.bag_id=b.id AND a.family_id=${familyId} AND a.leg=${leg}))
  AND (bl.status NOT IN ('ready','in_transit','collected') OR bl.needs_review OR bl.confirmed_at IS NULL))
 AND NOT EXISTS(SELECT 1 FROM packing_allocations a JOIN bags b ON b.id=a.bag_id WHERE a.family_id=${familyId} AND a.leg=${leg} AND (b.removed_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM bag_legs bl WHERE bl.bag_id=b.id AND bl.leg=${leg})))
 AND NOT EXISTS(SELECT 1 FROM departure_checks WHERE family_id=${familyId} AND leg=${leg} AND removed_at IS NULL AND NOT checked)
 AND (${leg}<>'return' OR ((SELECT count(*) FROM return_checkout WHERE family_id=${familyId})=4 AND NOT EXISTS(SELECT 1 FROM return_checkout WHERE family_id=${familyId} AND NOT checked))) AS ready`);
  return result.rows[0]?.ready ?? false;
}
export async function refreshFamilyReadiness(
  db: DatabaseTransaction,
  familyId: string,
) {
  const family = (
    await db.execute<{ trip_id: string }>(
      sql`SELECT trip_id FROM families WHERE id=${familyId} FOR UPDATE`,
    )
  ).rows[0];
  if (!family) return false;
  let notified = false;
  for (const leg of ["outbound", "return"]) {
    const ready = await familyIsReady(db, familyId, leg);
    await db.execute(
      sql`INSERT INTO family_readiness(family_id,leg) VALUES(${familyId},${leg}) ON CONFLICT DO NOTHING`,
    );
    const changed = await db.execute<{ version: number }>(
      sql`UPDATE family_readiness SET ready=${ready},version=version+1,ready_at=CASE WHEN ${ready} THEN clock_timestamp() ELSE ready_at END,updated_at=clock_timestamp() WHERE family_id=${familyId} AND leg=${leg} AND ready<>${ready} RETURNING version`,
    );
    if (ready && changed.rows[0]) {
      const events =
        await db.execute(sql`INSERT INTO notification_events(source_key,recipient_id,trip_id,kind)
    SELECT ${`family-ready:${familyId}:${leg}:${changed.rows[0].version}`},tm.member_id,tm.trip_id,'tripChanges' FROM trip_members tm JOIN notification_preferences p ON p.member_id=tm.member_id AND p.trip_changes WHERE tm.trip_id=${family.trip_id} ON CONFLICT DO NOTHING RETURNING id`);
      notified ||= Boolean(events.rowCount);
    }
  }
  return notified;
}
// Run after the response, and prove the source history committed first. A rolled
// back save, including a later statement failure, cannot publish readiness.
export function readinessAfterResponse(
  familyId: string,
  proof: { kind: "packing" | "checklist"; id: string },
) {
  after(async () => {
    try {
      const notify = await transaction(async (db) => {
        const table =
          proof.kind === "packing"
            ? sql`packing_history`
            : sql`checklist_history`;
        if (
          !(
            await db.execute(
              sql`SELECT id FROM ${table} WHERE id=${proof.id} AND family_id=${familyId}`,
            )
          ).rowCount
        )
          return;
        // Shared bags may affect the families whose contents are in them.
        const affected = await db.execute<{ id: string }>(
          sql`SELECT id FROM families WHERE id=${familyId} OR id IN (SELECT a.family_id FROM packing_allocations a JOIN bags b ON b.id=a.bag_id WHERE b.family_id=${familyId}) ORDER BY id`,
        );
        let changed = false;
        for (const family of affected.rows)
          changed = (await refreshFamilyReadiness(db, family.id)) || changed;
        return changed;
      });
      if (notify)
        await (
          await import("./notification-dispatch")
        ).dispatchPendingNotifications();
    } catch {
      console.warn(
        "Packing update deferred; no readiness delivery is confirmed.",
      );
    }
  });
}
async function tips(
  db: DatabaseTransaction,
  actor: string,
  tripId: string,
  role: string,
) {
  const result =
    await db.execute(sql`SELECT t.id,t.title,t.body,t.source_url AS "sourceUrl",trim(m.first_name||' '||m.last_name) AS author,
 to_char(t.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",to_char(t.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt",
 (t.author_id=${actor} AND ${role}<>'viewer') AS "canEdit",(${role}<>'viewer' AND (t.author_id=${actor} OR ${role}='organizer')) AS "canRemove" FROM trip_tips t JOIN members m ON m.id=t.author_id WHERE t.trip_id=${tripId} AND t.removed_at IS NULL ORDER BY t.created_at DESC,t.id LIMIT 100`);
  return result.rows;
}
export function readTripUpdates(actor: string, tripId: string) {
  return transaction(async (db) => {
    const trip = await requireTripAccess(db, actor, tripId);
    const result =
      await db.execute(sql`SELECT f.id AS "familyId",f.name AS "familyName",r.leg,r.ready,
 to_char(r.ready_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "readyAt"
 FROM family_readiness r JOIN families f ON f.id=r.family_id WHERE f.trip_id=${tripId} AND r.ready_at IS NOT NULL ORDER BY r.updated_at DESC,f.id FOR SHARE OF f,r`);
    // A queued background job may not have processed a just-accepted edit yet.
    for (const row of result.rows)
      if (row.ready)
        row.ready = await familyIsReady(
          db,
          String(row.familyId),
          String(row.leg),
        );
    return {
      readiness: result.rows,
      tips: await tips(db, actor, tripId, trip.role),
      canPost: trip.role !== "viewer",
    };
  });
}
export function createTripTip(
  actor: string,
  tripId: string,
  input: TripTipInput,
) {
  return transaction(async (db) => {
    await requireTripAccess(db, actor, tripId, "edit");
    const id = await createOnce(
      db,
      actor,
      `trip-tip:${tripId}`,
      input,
      async (id) => {
        const { requestId, ...fields } = input;
        await db
          .insert(tripTips)
          .values({ ...fields, id, tripId, authorId: actor });
        await db.execute(
          sql`INSERT INTO notification_events(source_key,recipient_id,trip_id,kind) SELECT ${`trip-tip:${id}`},tm.member_id,tm.trip_id,'tripChanges' FROM trip_members tm JOIN notification_preferences p ON p.member_id=tm.member_id AND p.trip_changes WHERE tm.trip_id=${tripId} AND tm.member_id<>${actor} ON CONFLICT DO NOTHING`,
        );
        dispatchAfterResponse();
      },
    );
    return { saved: true, id };
  });
}
async function editable(
  db: DatabaseTransaction,
  actor: string,
  tripId: string,
  id: string,
  remove = false,
) {
  resourceId(id);
  const trip = await requireTripAccess(db, actor, tripId, "edit");
  const [tip] = await db
    .select()
    .from(tripTips)
    .where(and(eq(tripTips.id, id), eq(tripTips.tripId, tripId)))
    .for("update");
  if (
    !tip ||
    (!remove && tip.removedAt) ||
    !(tip.authorId === actor || (remove && trip.role === "organizer"))
  )
    throw new HttpError(404, "not_found", "This tip is not available to you.");
  return tip;
}
export function patchTripTip(
  actor: string,
  tripId: string,
  id: string,
  input: TripTipPatch,
) {
  return transaction(async (db) => {
    await editable(db, actor, tripId, id);
    await createOnce(
      db,
      actor,
      `trip-tip-edit:${tripId}:${id}`,
      input,
      async () => {
        const { requestId, ...fields } = input;
        await db
          .update(tripTips)
          .set({ ...fields, updatedAt: sql`clock_timestamp()` })
          .where(eq(tripTips.id, id));
      },
    );
    return { saved: true };
  });
}
export function removeTripTip(actor: string, tripId: string, id: string) {
  return transaction(async (db) => {
    await editable(db, actor, tripId, id, true);
    await db
      .update(tripTips)
      .set({ removedAt: sql`clock_timestamp()` })
      .where(eq(tripTips.id, id));
    return { saved: true };
  });
}
