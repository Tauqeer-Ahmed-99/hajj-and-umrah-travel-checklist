import {
  itineraryEntryInput,
  type Itinerary,
  type ItineraryPatch,
  type ItineraryEntry,
  type ItineraryEntryInput,
  type ItineraryEntryPatch,
} from "@nmt/contracts";
import type { PoolClient } from "pg";
import { requireTripAccess, resourceId } from "./permissions";
import { createOnce, transaction } from "./trips";
import { HttpError } from "./response";
import { itineraryChanged } from "./notification-events";
import { checkCompletionPhase } from "./completion";

const referenceColumns = `accommodation_address AS "accommodationAddress", transport_reference AS "transportReference", meeting_point AS "meetingPoint", contacts`;
const entryColumns = `id, trip_id AS "tripId", kind, title, starts_at AS "startsAt", ends_at AS "endsAt", ${referenceColumns}, notes`;
const referenceFields = {
  phase: "phase",
  accommodationAddress: "accommodation_address",
  transportReference: "transport_reference",
  meetingPoint: "meeting_point",
  contacts: "contacts",
} as const;

async function read(
  db: PoolClient,
  memberId: string,
  tripId: string,
): Promise<Itinerary> {
  const trip = await requireTripAccess(db, memberId, tripId);
  const result = await db.query(
    `SELECT phase, ${referenceColumns} FROM trip_itineraries WHERE trip_id = $1`,
    [tripId],
  );
  const entries = await db.query<ItineraryEntry>(
    `SELECT ${entryColumns} FROM itinerary_entries WHERE trip_id = $1 ORDER BY position, id`,
    [tripId],
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

async function lockItinerary(db: PoolClient, memberId: string, tripId: string) {
  const trip = await requireTripAccess(db, memberId, tripId, "organize");
  // Serialize ordering and partial validation for this trip without touching family grants.
  await db.query("SELECT id FROM trips WHERE id = $1 FOR UPDATE", [tripId]);
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
        await db.query(
          `INSERT INTO itinerary_entries (id, trip_id, kind, title, starts_at, ends_at, accommodation_address, transport_reference, meeting_point, contacts, notes, position)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,(SELECT COALESCE(MAX(position), -1) + 1 FROM itinerary_entries WHERE trip_id = $2))`,
          [
            id,
            tripId,
            input.kind,
            input.title,
            JSON.stringify(input.startsAt),
            JSON.stringify(input.endsAt),
            input.accommodationAddress,
            input.transportReference,
            input.meetingPoint,
            JSON.stringify(input.contacts),
            input.notes,
          ],
        );
        await itineraryChanged(db, memberId, tripId);
      },
    );
    const result = await db.query<ItineraryEntry>(
      `SELECT ${entryColumns} FROM itinerary_entries WHERE id = $1 AND trip_id = $2`,
      [id, tripId],
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
    await db.query(
      "INSERT INTO trip_itineraries (trip_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [tripId],
    );
    const fields = Object.keys(input) as (keyof ItineraryPatch)[];
    const before = await read(db, memberId, tripId);
    await db.query(
      `UPDATE trip_itineraries SET ${fields.map((key, i) => `${referenceFields[key]} = $${i + 2}`).join(", ")} WHERE trip_id = $1`,
      [
        tripId,
        ...fields.map((key) =>
          key === "contacts" ? JSON.stringify(input[key]) : input[key],
        ),
      ],
    );
    if (
      fields.some(
        (key) => JSON.stringify(input[key]) !== JSON.stringify(before[key]),
      )
    )
      await itineraryChanged(db, memberId, tripId);
    return read(db, memberId, tripId);
  });
}

const entryFields = {
  ...referenceFields,
  kind: "kind",
  title: "title",
  startsAt: "starts_at",
  endsAt: "ends_at",
  notes: "notes",
};
export function patchItineraryEntry(
  memberId: string,
  tripId: string,
  entryId: string,
  input: ItineraryEntryPatch,
) {
  return transaction(async (db) => {
    const trip = await lockItinerary(db, memberId, tripId);
    resourceId(entryId);
    const existing = await db.query<ItineraryEntry>(
      `SELECT ${entryColumns} FROM itinerary_entries WHERE id = $1 AND trip_id = $2`,
      [entryId, tripId],
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
    const result = await db.query<ItineraryEntry>(
      `UPDATE itinerary_entries SET ${fields.map((key, i) => `${entryFields[key]} = $${i + 3}`).join(", ")} WHERE id = $1 AND trip_id = $2 RETURNING ${entryColumns}`,
      [
        entryId,
        tripId,
        ...fields.map((key) =>
          ["contacts", "startsAt", "endsAt"].includes(key)
            ? JSON.stringify(input[key])
            : input[key],
        ),
      ],
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
    const current = await db.query<{ id: string }>(
      "SELECT id FROM itinerary_entries WHERE trip_id = $1 ORDER BY position, id",
      [tripId],
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
    await db.query(
      `UPDATE itinerary_entries e SET position = ordered.position - 1 FROM unnest($2::uuid[]) WITH ORDINALITY AS ordered(id, position) WHERE e.trip_id = $1 AND e.id = ordered.id`,
      [tripId, entryIds],
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
    const removed = await db.query(
      "DELETE FROM itinerary_entries WHERE id = $1 AND trip_id = $2",
      [entryId, tripId],
    );
    if (removed.rowCount) await itineraryChanged(db, memberId, tripId);
    return read(db, memberId, tripId);
  });
}
