import { sql } from "drizzle-orm";
import type {
  Family,
  FamilyInput,
  Traveler,
  TravelerInput,
  Trip,
  TripDetail,
  TripInput,
} from "@nmt/contracts";
import { randomUUID } from "node:crypto";
import { database, type DatabaseTransaction } from "./database";
import {
  requireFamilyAccess,
  requireTripAccess,
  tripColumns,
  type PermissionDatabase,
} from "./permissions";
import { HttpError } from "./response";
import { lockAccountAccess, requireActiveMember } from "./account-access";

export async function transaction<T>(
  work: (db: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return database().transaction(work);
}

export async function createOnce(
  db: DatabaseTransaction,
  memberId: string,
  scope: string,
  input: { requestId?: string },
  create: (id: string) => Promise<void>,
): Promise<string> {
  const { requestId = randomUUID(), ...body } = input;
  const values = [memberId, requestId, scope, JSON.stringify(body)];
  const inserted = await db.execute<{ resource_id: string }>(sql`
    INSERT INTO creation_requests (member_id, request_id, scope, input)
    VALUES (${sql.param(values[0])}, ${sql.param(values[1])}, ${sql.param(values[2])}, ${sql.param(values[3])}) ON CONFLICT (member_id, request_id) DO NOTHING RETURNING resource_id`);
  if (inserted.rows[0]) {
    await create(inserted.rows[0].resource_id);
    return inserted.rows[0].resource_id;
  }
  const existing = await db.execute<{
    resource_id: string;
    matches: boolean;
  }>(sql`
    SELECT resource_id, (scope = ${sql.param(values[2])} AND input = ${sql.param(values[3])}::jsonb) AS matches
    FROM creation_requests WHERE member_id = ${sql.param(values[0])} AND request_id = ${sql.param(values[1])}`);
  if (!existing.rows[0]?.matches)
    throw new HttpError(
      409,
      "request_conflict",
      "This save was already used for different details. Reopen the saved record before starting a new save.",
    );
  return existing.rows[0].resource_id;
}

export async function listTrips(memberId: string) {
  const result = await database().execute<Trip>(sql`
    SELECT ${sql.raw(tripColumns)} FROM trips t JOIN trip_members tm ON tm.trip_id = t.id
    WHERE tm.member_id = ${sql.param(memberId)} ORDER BY t.created_at DESC, t.id`);
  return { trips: result.rows };
}

export async function readTrip(
  db: PermissionDatabase,
  memberId: string,
  tripId: string,
): Promise<TripDetail> {
  const trip = await requireTripAccess(db, memberId, tripId);
  // Organizer authority never widens this family audience.
  const families = await db.execute<Family>(sql`
    SELECT f.id, f.trip_id AS "tripId", f.name, fm.role,
      (fm.role <> 'viewer' AND ${sql.param(trip.role)} <> 'viewer') AS "canEdit",
      (fm.role = 'coordinator' AND ${sql.param(trip.role)} <> 'viewer') AS "canCoordinate"
    FROM families f JOIN family_members fm ON fm.family_id = f.id
    WHERE f.trip_id = ${sql.param(tripId)} AND fm.member_id = ${sql.param(memberId)} ORDER BY f.created_at, f.id`);
  return { trip, families: families.rows };
}

export async function createTrip(memberId: string, input: TripInput) {
  return transaction(async (db) => {
    await lockAccountAccess(db);
    await requireActiveMember(db, memberId);
    const tripId = await createOnce(
      db,
      memberId,
      "trip",
      input,
      async (tripId) => {
        await db.execute(sql`
      INSERT INTO trips (id, name, kind, start_date, end_date, destinations)
      VALUES (${sql.param(tripId)}, ${sql.param(input.name)}, ${sql.param(input.kind)}, ${sql.param(input.startDate)}, ${sql.param(input.endDate)}, ${sql.param(input.destinations)})`);
        await db.execute(
          sql`INSERT INTO trip_members (trip_id, member_id, role) VALUES (${sql.param(tripId)}, ${sql.param(memberId)}, 'organizer')`,
        );
        const family = await db.execute<{ id: string }>(
          sql`INSERT INTO families (trip_id, name) VALUES (${sql.param(tripId)}, ${sql.param(input.familyName)}) RETURNING id`,
        );
        await db.execute(
          sql`INSERT INTO family_members (trip_id, family_id, member_id, role) VALUES (${sql.param(tripId)}, ${sql.param(family.rows[0].id)}, ${sql.param(memberId)}, 'coordinator')`,
        );
      },
    );
    return readTrip(db, memberId, tripId);
  });
}

export async function createFamily(
  memberId: string,
  tripId: string,
  input: FamilyInput,
) {
  return transaction(async (db) => {
    await lockAccountAccess(db);
    await requireTripAccess(db, memberId, tripId, "organize");
    const familyId = await createOnce(
      db,
      memberId,
      `family:${tripId}`,
      input,
      async (familyId) => {
        await db.execute(
          sql`INSERT INTO families (id, trip_id, name) VALUES (${sql.param(familyId)}, ${sql.param(tripId)}, ${sql.param(input.name)})`,
        );
        await db.execute(
          sql`INSERT INTO family_members (trip_id, family_id, member_id, role) VALUES (${sql.param(tripId)}, ${sql.param(familyId)}, ${sql.param(memberId)}, 'coordinator')`,
        );
      },
    );
    return {
      family: await requireFamilyAccess(db, memberId, tripId, familyId),
    };
  });
}

const travelerColumns = `id, family_id AS "familyId", first_name AS "firstName", last_name AS "lastName"`;

export async function listTravelers(
  memberId: string,
  tripId: string,
  familyId: string,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, memberId, tripId, familyId);
    const result = await db.execute<Traveler>(
      sql`SELECT ${sql.raw(travelerColumns)} FROM travelers WHERE trip_id = ${sql.param(tripId)} AND family_id = ${sql.param(familyId)} ORDER BY created_at, id`,
    );
    return { travelers: result.rows };
  });
}

export async function createTraveler(
  memberId: string,
  tripId: string,
  familyId: string,
  input: TravelerInput,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, memberId, tripId, familyId, "coordinate");
    const travelerId = await createOnce(
      db,
      memberId,
      `traveler:${tripId}:${familyId}`,
      input,
      async (id) => {
        await db.execute(
          sql`INSERT INTO travelers (id, trip_id, family_id, first_name, last_name) VALUES (${sql.param(id)}, ${sql.param(tripId)}, ${sql.param(familyId)}, ${sql.param(input.firstName)}, ${sql.param(input.lastName)})`,
        );
      },
    );
    const result = await db.execute<Traveler>(
      sql`SELECT ${sql.raw(travelerColumns)} FROM travelers WHERE id = ${sql.param(travelerId)} AND trip_id = ${sql.param(tripId)} AND family_id = ${sql.param(familyId)}`,
    );
    return { traveler: result.rows[0] };
  });
}
