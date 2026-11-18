import { and, eq, sql } from "drizzle-orm";
import type { FamilyPatch, TravelerPatch, TripPatch } from "@nmt/contracts";
import { families, travelers, trips } from "./schema";
import { transaction, readTrip } from "./trips";
import type { DatabaseTransaction } from "./database";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { lockAccountAccess, requireActiveMember } from "./account-access";
import { HttpError } from "./response";

async function lockEditableTrip(db: DatabaseTransaction, tripId: string) {
  const current = await db.execute<{ startDate: string; endDate: string }>(sql`
    SELECT start_date::text AS "startDate", end_date::text AS "endDate"
    FROM trips WHERE id=${tripId} FOR UPDATE`);
  const archived = await db.execute(sql`
    SELECT trip_id FROM trip_completion WHERE trip_id=${tripId} AND archived_at IS NOT NULL`);
  if (archived.rowCount)
    throw new HttpError(
      409,
      "trip_archived",
      "Reopen this archived trip before editing its details.",
    );
  return current.rows[0];
}

export function editTrip(memberId: string, tripId: string, input: TripPatch) {
  return transaction(async (db) => {
    await lockAccountAccess(db);
    await requireActiveMember(db, memberId);
    await requireTripAccess(db, memberId, tripId, "organize");
    const current = await lockEditableTrip(db, tripId);
    if (
      (input.endDate ?? current.endDate) <
      (input.startDate ?? current.startDate)
    )
      throw new HttpError(
        422,
        "invalid_trip",
        "Return date must be on or after departure.",
        { endDate: "Return date must be on or after departure." },
      );
    await db.update(trips).set(input).where(eq(trips.id, tripId));
    return readTrip(db, memberId, tripId);
  });
}

export function editFamily(
  memberId: string,
  tripId: string,
  familyId: string,
  input: FamilyPatch,
) {
  return transaction(async (db) => {
    await lockAccountAccess(db);
    await requireActiveMember(db, memberId);
    await requireFamilyAccess(db, memberId, tripId, familyId, "coordinate");
    await lockEditableTrip(db, tripId);
    await db
      .update(families)
      .set({ name: input.name })
      .where(and(eq(families.id, familyId), eq(families.tripId, tripId)));
    return {
      family: await requireFamilyAccess(db, memberId, tripId, familyId),
    };
  });
}

export function editTraveler(
  memberId: string,
  tripId: string,
  familyId: string,
  travelerId: string,
  input: TravelerPatch,
) {
  return transaction(async (db) => {
    await lockAccountAccess(db);
    await requireActiveMember(db, memberId);
    await requireFamilyAccess(db, memberId, tripId, familyId, "coordinate");
    resourceId(travelerId);
    await lockEditableTrip(db, tripId);
    const [traveler] = await db
      .update(travelers)
      .set(input)
      .where(
        and(
          eq(travelers.id, travelerId),
          eq(travelers.tripId, tripId),
          eq(travelers.familyId, familyId),
        ),
      )
      .returning({
        id: travelers.id,
        familyId: travelers.familyId,
        firstName: travelers.firstName,
        lastName: travelers.lastName,
      });
    if (!traveler)
      throw new HttpError(
        404,
        "not_found",
        "This traveler is not available in this family.",
      );
    return { traveler };
  });
}
