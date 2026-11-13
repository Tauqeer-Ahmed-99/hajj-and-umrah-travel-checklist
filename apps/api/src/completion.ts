import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  Completion,
  CompletionInput,
  CompletionReview,
  Itinerary,
} from "@nmt/contracts";
import {
  requireTripAccess,
  requireFamilyAccess,
  tripColumns,
} from "./permissions";
import { createOnce, transaction, readTrip } from "./trips";
import { HttpError } from "./response";
import { itineraryChanged } from "./notification-events";
import { bagColumns } from "./packing";
import { returnItems } from "./return-preparation";
import { sharedState } from "./sharing";
import type { Bag } from "@nmt/contracts";
type TripPhase = Itinerary["phase"];

async function phase(db: PoolClient, tripId: string): Promise<TripPhase> {
  return (
    (
      await db.query("SELECT phase FROM trip_itineraries WHERE trip_id=$1", [
        tripId,
      ])
    ).rows[0]?.phase ?? "planning"
  );
}
async function state(
  db: PoolClient,
  memberId: string,
  tripId: string,
): Promise<Completion> {
  const trip = await requireTripAccess(db, memberId, tripId);
  const saved = (
    await db.query(
      `SELECT completed_at AS "completedAt",completed_by AS "completedBy",
    archived_at AS "archivedAt",archived_by AS "archivedBy" FROM trip_completion WHERE trip_id=$1`,
      [tripId],
    )
  ).rows[0];
  const history = (
    await db.query<Completion["history"][number]>(
      `SELECT id,action,actor,at FROM trip_completion_history WHERE trip_id=$1 ORDER BY sequence`,
      [tripId],
    )
  ).rows;
  const lessons = (
    await db.query<Completion["lessons"][number]>(
      `SELECT id,lesson AS text,actor,at FROM trip_completion_history WHERE trip_id=$1 AND action='lesson_added' ORDER BY sequence`,
      [tripId],
    )
  ).rows;
  return {
    tripId,
    phase: await phase(db, tripId),
    canEdit: trip.role === "organizer",
    completedAt: null,
    completedBy: null,
    archivedAt: null,
    archivedBy: null,
    ...saved,
    history,
    lessons,
  };
}
async function review(
  db: PoolClient,
  memberId: string,
  tripId: string,
): Promise<CompletionReview> {
  await requireTripAccess(db, memberId, tripId);
  // The same family locks used by packing/sharing keep this accepted review
  // coherent. Locking a row grants no permission to read its private contents.
  await db.query(
    "SELECT id FROM families WHERE trip_id=$1 ORDER BY id FOR SHARE",
    [tripId],
  );
  const detail = await readTrip(db, memberId, tripId);
  const bags: CompletionReview["bags"] = [];
  const items: CompletionReview["items"] = [];
  const addBag = (bag: Pick<Bag, "id" | "familyId" | "name" | "legs">) => {
    const home = bag.legs.find((l) => l.leg === "return");
    bags.push({
      id: bag.id,
      familyId: bag.familyId,
      name: bag.name,
      status: home?.status ?? null,
      needsReview: home?.needsReview ?? true,
      confirmedAt: home?.confirmedAt ?? null,
    });
  };
  for (const family of detail.families) {
    await requireFamilyAccess(db, memberId, tripId, family.id);
    for (const bag of (
      await db.query<Bag>(
        `SELECT ${bagColumns} FROM bags b WHERE b.family_id=$1 AND b.removed_at IS NULL ORDER BY b.id`,
        [family.id],
      )
    ).rows)
      addBag(bag);
    const reconciled = await returnItems(db, family.id);
    const entries = (
      await db.query<{ entryId: string; title: string; unit: string }>(
        `SELECT id AS "entryId",title,unit FROM checklist_entries WHERE family_id=$1 AND kind='item'
        AND removed_at IS NULL AND not_needed_reason IS NULL ORDER BY id`,
        [family.id],
      )
    ).rows;
    for (const entry of [
      ...entries,
      ...reconciled.filter(
        (r) => !entries.some((e) => e.entryId === r.entryId),
      ),
    ]) {
      const r = reconciled.find((r) => r.entryId === entry.entryId);
      items.push({
        entryId: entry.entryId,
        familyId: family.id,
        title: entry.title,
        unit: entry.unit,
        verification:
          r?.reviewed && r.possessionConfirmedAt ? "reviewed" : "unverified",
        possessionConfirmedAt: r?.possessionConfirmedAt ?? null,
        requiredQuantity: r?.requiredQuantity ?? null,
        possessionQuantity: r?.possessionQuantity ?? null,
        unaccounted: r?.unaccounted ?? null,
        remainingToVerify: r?.remainingToVerify ?? null,
        lostQuantity: r?.lost.quantity ?? null,
      });
    }
  }
  const shared = await sharedState(db, memberId, tripId, "return");
  for (const bag of shared.bags)
    if (!bags.some((b) => b.id === bag.id)) addBag(bag);
  for (const { entry } of shared.items)
    if (entry.kind === "item" && !items.some((i) => i.entryId === entry.id))
      items.push({
        entryId: entry.id,
        familyId: entry.familyId,
        title: entry.title,
        unit: entry.unit,
        verification: "limited",
        possessionConfirmedAt: null,
        requiredQuantity: null,
        possessionQuantity: null,
        unaccounted: null,
        remainingToVerify: null,
        lostQuantity: null,
      });
  bags.sort((a, b) => a.id.localeCompare(b.id));
  items.sort((a, b) => a.entryId.localeCompare(b.entryId));
  const data = {
    scope: "permitted_records_only" as const,
    phase: await phase(db, tripId),
    bags,
    items,
  };
  return {
    ...data,
    reviewToken: createHash("sha256")
      .update(JSON.stringify({ memberId, tripId, ...data }))
      .digest("hex"),
  };
}
async function record(
  db: PoolClient,
  memberId: string,
  tripId: string,
  id: string,
  action: Completion["history"][number]["action"],
  lesson: string | null = null,
) {
  await db.query(
    `INSERT INTO trip_completion_history (id,trip_id,action,actor,lesson)
    SELECT $1,$2,$3,first_name || ' ' || last_name || ' (@' || username || ')',$5 FROM members WHERE id=$4`,
    [id, tripId, action, memberId, lesson],
  );
}
export function readCompletion(memberId: string, tripId: string) {
  return transaction(async (db) => {
    await requireTripAccess(db, memberId, tripId);
    await db.query("SELECT id FROM trips WHERE id=$1 FOR SHARE", [tripId]);
    return state(db, memberId, tripId);
  });
}
export function readCompletionReview(memberId: string, tripId: string) {
  return transaction(async (db) => {
    await requireTripAccess(db, memberId, tripId);
    await db.query("SELECT id FROM trips WHERE id=$1 FOR SHARE", [tripId]);
    return review(db, memberId, tripId);
  });
}
export function mutateCompletion(
  memberId: string,
  tripId: string,
  input: CompletionInput,
) {
  return transaction(async (db) => {
    await requireTripAccess(db, memberId, tripId, "organize");
    await db.query("SELECT id FROM trips WHERE id=$1 FOR UPDATE", [tripId]);
    await createOnce(
      db,
      memberId,
      `completion:${tripId}`,
      input,
      async (id) => {
        const currentPhase = await phase(db, tripId);
        const confirmed = (
          await db.query(
            "SELECT completed_at FROM trip_completion WHERE trip_id=$1",
            [tripId],
          )
        ).rows[0]?.completed_at;
        if (input.kind !== "complete") {
          if (currentPhase !== "completed" || !confirmed)
            throw new HttpError(
              409,
              "trip_not_completed",
              "Review home arrival and confirm the travel journey Completed before recording lessons or archiving.",
            );
          if (input.kind === "lesson") {
            await record(db, memberId, tripId, id, "lesson_added", input.text);
          } else {
            const changed = await db.query(
              `INSERT INTO trip_completion (trip_id,archived_at,archived_by) VALUES ($1,clock_timestamp(),$2)
            ON CONFLICT (trip_id) DO UPDATE SET archived_at=clock_timestamp(),archived_by=$2
            WHERE trip_completion.archived_at IS NULL RETURNING trip_id`,
              [tripId, memberId],
            );
            if (changed.rowCount)
              await record(db, memberId, tripId, id, "archived");
          }
          return;
        }
        if (
          input.reviewToken !== (await review(db, memberId, tripId)).reviewToken
        )
          throw new HttpError(
            409,
            "completion_review_changed",
            "Arrival information changed. Review it again before confirming Completed.",
          );
        if (currentPhase === "completed" && confirmed) return;
        await db.query(
          `INSERT INTO trip_itineraries (trip_id,phase) VALUES ($1,'completed')
        ON CONFLICT (trip_id) DO UPDATE SET phase='completed'`,
          [tripId],
        );
        await db.query(
          `INSERT INTO trip_completion (trip_id,completed_at,completed_by) VALUES ($1,clock_timestamp(),$2)
        ON CONFLICT (trip_id) DO UPDATE SET completed_at=clock_timestamp(),completed_by=$2`,
          [tripId, memberId],
        );
        await record(db, memberId, tripId, id, "completed");
        if (currentPhase !== "completed")
          await itineraryChanged(db, memberId, tripId);
      },
    );
    return state(db, memberId, tripId);
  });
}
export function listArchives(memberId: string) {
  return transaction(async (db) => {
    const rows = (
      await db.query(
        `SELECT ${tripColumns},c.archived_at AS "archivedAt"
      FROM trips t JOIN trip_members tm ON tm.trip_id=t.id JOIN trip_completion c ON c.trip_id=t.id
      WHERE tm.member_id=$1 AND c.archived_at IS NOT NULL ORDER BY c.archived_at DESC,t.id FOR SHARE OF tm`,
        [memberId],
      )
    ).rows;
    return {
      archives: rows.map(({ archivedAt, ...trip }) => ({ trip, archivedAt })),
    };
  });
}
export async function checkCompletionPhase(
  db: PoolClient,
  memberId: string,
  tripId: string,
  next: TripPhase,
) {
  if (next === "completed")
    throw new HttpError(
      409,
      "completion_review_required",
      "Open Completion and archive to review home arrival before confirming Completed.",
    );
  if ((await phase(db, tripId)) === "completed") {
    const saved = (
      await db.query(
        "SELECT archived_at FROM trip_completion WHERE trip_id=$1",
        [tripId],
      )
    ).rows[0];
    if (saved?.archived_at)
      throw new HttpError(
        409,
        "trip_archived",
        "An archived trip retains its Completed phase.",
      );
    await record(db, memberId, tripId, randomUUID(), "phase_corrected");
  }
}
