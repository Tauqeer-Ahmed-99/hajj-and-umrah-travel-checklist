import { and, eq, sql } from "drizzle-orm";
import { itineraryEntries, tripItineraries } from "./schema";
import {
  itineraryEntryInput,
  type Itinerary,
  type ItineraryPatch,
  type ItineraryEntry,
  type ItineraryEntryInput,
  type ItineraryEntryPatch,
} from "@nmt/contracts";
import type { DatabaseTransaction } from "./database";
import { requireTripAccess, resourceId } from "./permissions";
import { createOnce, transaction } from "./trips";
import { HttpError } from "./response";
import { itineraryChanged } from "./notification-events";
import { checkCompletionPhase } from "./completion";

const referenceColumns = `accommodation_address AS "accommodationAddress", transport_reference AS "transportReference", meeting_point AS "meetingPoint", contacts`;
const entryColumns = `id, trip_id AS "tripId", kind, title, starts_at AS "startsAt", ends_at AS "endsAt", ${referenceColumns}, notes`;

async function read(
  db: DatabaseTransaction,
  memberId: string,
  tripId: string,
): Promise<Itinerary> {
  const trip = await requireTripAccess(db, memberId, tripId);
  const result = await db.execute(
    sql`SELECT phase, ${sql.raw(referenceColumns)} FROM trip_itineraries WHERE trip_id = ${sql.param(tripId)}`,
  );
  const entries = await db.execute<ItineraryEntry>(
    sql`SELECT ${sql.raw(entryColumns)} FROM itinerary_entries WHERE trip_id = ${sql.param(tripId)} ORDER BY position, id`,
  );
  return {
    phase: "planning",
    accommodationAddress: "",
    transportReference: "",
    meetingPoint: "",
    contacts: [],
    ...result.rows[0],
    entries: entries.rows,
    canEdit: trip.role === "organizer",
  };
}

async function lockItinerary(
  db: DatabaseTransaction,
  memberId: string,
  tripId: string,
) {
  const trip = await requireTripAccess(db, memberId, tripId, "organize");
  // Serialize ordering and partial validation for this trip without touching family grants.
  await db.execute(
    sql`SELECT id FROM trips WHERE id = ${sql.param(tripId)} FOR UPDATE`,
  );
  return trip;
}
export function createItineraryEntry(
  memberId: string,
  tripId: string,
  input: ItineraryEntryInput,
) {
  return transaction(async (db) => {
    const trip = await lockItinerary(db, memberId, tripId);
    if (input.kind === "hajj_milestone" && trip.kind !== "hajj")
      throw new HttpError(
        422,
        "invalid_itinerary",
        "Hajj milestones belong to a Hajj trip.",
        { kind: "Choose a stop for an Umrah trip." },
      );
    const id = await createOnce(
      db,
      memberId,
      `itinerary:${tripId}`,
      input,
      async (id) => {
        await db.execute(sql`INSERT INTO itinerary_entries (id, trip_id, kind, title, starts_at, ends_at, accommodation_address, transport_reference, meeting_point, contacts, notes, position)
        VALUES (${sql.param(id)},${sql.param(tripId)},${sql.param(input.kind)},${sql.param(input.title)},${sql.param(JSON.stringify(input.startsAt))},${sql.param(JSON.stringify(input.endsAt))},${sql.param(input.accommodationAddress)},${sql.param(input.transportReference)},${sql.param(input.meetingPoint)},${sql.param(JSON.stringify(input.contacts))},${sql.param(input.notes)},(SELECT COALESCE(MAX(position), -1) + 1 FROM itinerary_entries WHERE trip_id = ${sql.param(tripId)}))`);
        await itineraryChanged(db, memberId, tripId);
      },
    );
    const result = await db.execute<ItineraryEntry>(
      sql`SELECT ${sql.raw(entryColumns)} FROM itinerary_entries WHERE id = ${sql.param(id)} AND trip_id = ${sql.param(tripId)}`,
    );
    if (!result.rows[0])
      throw new HttpError(
        410,
        "entry_removed",
        "This saved entry was removed. Refresh the itinerary.",
      );
    return { entry: result.rows[0] };
  });
}
export function readItinerary(memberId: string, tripId: string) {
  return transaction((db) => read(db, memberId, tripId));
}
export function patchItinerary(
  memberId: string,
  tripId: string,
  input: ItineraryPatch,
) {
  return transaction(async (db) => {
    await lockItinerary(db, memberId, tripId);
    if (input.phase)
      await checkCompletionPhase(db, memberId, tripId, input.phase);
    await db.execute(
      sql`INSERT INTO trip_itineraries (trip_id) VALUES (${sql.param(tripId)}) ON CONFLICT DO NOTHING`,
    );
    const fields = Object.keys(input) as (keyof ItineraryPatch)[];
    const before = await read(db, memberId, tripId);
    await db
      .update(tripItineraries)
      .set(input)
      .where(eq(tripItineraries.tripId, tripId));
    if (
      fields.some(
        (key) => JSON.stringify(input[key]) !== JSON.stringify(before[key]),
      )
    )
      await itineraryChanged(db, memberId, tripId);
    return read(db, memberId, tripId);
  });
}

export function patchItineraryEntry(
  memberId: string,
  tripId: string,
  entryId: string,
  input: ItineraryEntryPatch,
) {
  return transaction(async (db) => {
    const trip = await lockItinerary(db, memberId, tripId);
    resourceId(entryId);
    const existing = await db.execute<ItineraryEntry>(
      sql`SELECT ${sql.raw(entryColumns)} FROM itinerary_entries WHERE id = ${sql.param(entryId)} AND trip_id = ${sql.param(tripId)}`,
    );
    if (!existing.rows[0])
      throw new HttpError(
        404,
        "not_found",
        "This itinerary entry is not available to you.",
      );
    const { id, tripId: ignoredTripId, ...current } = existing.rows[0];
    const parsed = itineraryEntryInput.safeParse({ ...current, ...input });
    if (!parsed.success)
      throw new HttpError(
        422,
        "invalid_itinerary",
        "Check the highlighted itinerary fields.",
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "form"),
            issue.message,
          ]),
        ),
      );
    if (parsed.data.kind === "hajj_milestone" && trip.kind !== "hajj")
      throw new HttpError(
        422,
        "invalid_itinerary",
        "Hajj milestones belong to a Hajj trip.",
      );
    const fields = Object.keys(input) as (keyof ItineraryEntryPatch)[];
    await db
      .update(itineraryEntries)
      .set(input)
      .where(
        and(
          eq(itineraryEntries.id, entryId),
          eq(itineraryEntries.tripId, tripId),
        ),
      );
    const result = await db.execute<ItineraryEntry>(
      sql`SELECT ${sql.raw(entryColumns)} FROM itinerary_entries WHERE id=${entryId} AND trip_id=${tripId}`,
    );
    if (
      fields.some(
        (key) => JSON.stringify(input[key]) !== JSON.stringify(current[key]),
      )
    )
      await itineraryChanged(db, memberId, tripId);
    return { entry: result.rows[0] };
  });
}
export function orderItinerary(
  memberId: string,
  tripId: string,
  entryIds: string[],
) {
  return transaction(async (db) => {
    await lockItinerary(db, memberId, tripId);
    const current = await db.execute<{ id: string }>(
      sql`SELECT id FROM itinerary_entries WHERE trip_id = ${sql.param(tripId)} ORDER BY position, id`,
    );
    if (
      current.rows.length !== entryIds.length ||
      current.rows.some((row) => !entryIds.includes(row.id))
    )
      throw new HttpError(
        409,
        "itinerary_changed",
        "The itinerary changed. Refresh before reordering.",
      );
    await db.execute(
      sql`UPDATE itinerary_entries e SET position = ordered.position - 1 FROM unnest(${sql.param(entryIds)}::uuid[]) WITH ORDINALITY AS ordered(id, position) WHERE e.trip_id = ${sql.param(tripId)} AND e.id = ordered.id`,
    );
    if (current.rows.some((row, index) => row.id !== entryIds[index]))
      await itineraryChanged(db, memberId, tripId);
    return read(db, memberId, tripId);
  });
}
export function deleteItineraryEntry(
  memberId: string,
  tripId: string,
  entryId: string,
) {
  return transaction(async (db) => {
    await lockItinerary(db, memberId, tripId);
    resourceId(entryId);
    // Deleting an already absent entry is safe to repeat after a lost response.
    const removed = await db.execute(
      sql`DELETE FROM itinerary_entries WHERE id = ${sql.param(entryId)} AND trip_id = ${sql.param(tripId)}`,
    );
    if (removed.rowCount) await itineraryChanged(db, memberId, tripId);
    return read(db, memberId, tripId);
  });
}
