import type {
  Family,
  FamilyInput,
  Traveler,
  TravelerInput,
  Trip,
  TripDetail,
  TripInput,
} from "@nmt/contracts";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { database } from "./database";
import {
  requireFamilyAccess,
  requireTripAccess,
  tripColumns,
  type PermissionDatabase,
} from "./permissions";
import { HttpError } from "./response";

export async function transaction<T>(
  work: (db: PoolClient) => Promise<T>,
): Promise<T> {
  const db = await database().connect();
  try {
    await db.query("BEGIN");
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function createOnce(
  db: PoolClient,
  memberId: string,
  scope: string,
  input: { requestId?: string },
  create: (id: string) => Promise<void>,
): Promise<string> {
  const { requestId = randomUUID(), ...body } = input;
  const values = [memberId, requestId, scope, JSON.stringify(body)];
  const inserted = await db.query<{ resource_id: string }>(
    `
    INSERT INTO creation_requests (member_id, request_id, scope, input)
    VALUES ($1, $2, $3, $4) ON CONFLICT (member_id, request_id) DO NOTHING RETURNING resource_id`,
    values,
  );
  if (inserted.rows[0]) {
    await create(inserted.rows[0].resource_id);
    return inserted.rows[0].resource_id;
  }
  const existing = await db.query<{ resource_id: string; matches: boolean }>(
    `
    SELECT resource_id, (scope = $3 AND input = $4::jsonb) AS matches
    FROM creation_requests WHERE member_id = $1 AND request_id = $2`,
    values,
  );
  if (!existing.rows[0]?.matches)
    throw new HttpError(
      409,
      "request_conflict",
      "This save was already used for different details. Reopen the saved record before starting a new save.",
    );
  return existing.rows[0].resource_id;
}

export async function listTrips(memberId: string) {
  const result = await database().query<Trip>(
    `
    SELECT ${tripColumns} FROM trips t JOIN trip_members tm ON tm.trip_id = t.id
    WHERE tm.member_id = $1 ORDER BY t.created_at DESC, t.id`,
    [memberId],
  );
  return { trips: result.rows };
}

export async function readTrip(
  db: PermissionDatabase,
  memberId: string,
  tripId: string,
): Promise<TripDetail> {
  const trip = await requireTripAccess(db, memberId, tripId);
  // Organizer authority never widens this family audience.
  const families = await db.query<Family>(
    `
    SELECT f.id, f.trip_id AS "tripId", f.name, fm.role,
      (fm.role <> 'viewer' AND $3 <> 'viewer') AS "canEdit",
      (fm.role = 'coordinator' AND $3 <> 'viewer') AS "canCoordinate"
    FROM families f JOIN family_members fm ON fm.family_id = f.id
    WHERE f.trip_id = $1 AND fm.member_id = $2 ORDER BY f.created_at, f.id`,
    [tripId, memberId, trip.role],
  );
  return { trip, families: families.rows };
}

export async function createTrip(memberId: string, input: TripInput) {
  return transaction(async (db) => {
    const tripId = await createOnce(
      db,
      memberId,
      "trip",
      input,
      async (tripId) => {
        await db.query(
          `
      INSERT INTO trips (id, name, kind, start_date, end_date, destinations)
      VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tripId,
            input.name,
            input.kind,
            input.startDate,
            input.endDate,
            input.destinations,
          ],
        );
        await db.query(
          "INSERT INTO trip_members (trip_id, member_id, role) VALUES ($1, $2, 'organizer')",
          [tripId, memberId],
        );
        const family = await db.query<{ id: string }>(
          "INSERT INTO families (trip_id, name) VALUES ($1, $2) RETURNING id",
          [tripId, input.familyName],
        );
        await db.query(
          "INSERT INTO family_members (trip_id, family_id, member_id, role) VALUES ($1, $2, $3, 'coordinator')",
          [tripId, family.rows[0].id, memberId],
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
    await requireTripAccess(db, memberId, tripId, "organize");
    const familyId = await createOnce(
      db,
      memberId,
      `family:${tripId}`,
      input,
      async (familyId) => {
        await db.query(
          "INSERT INTO families (id, trip_id, name) VALUES ($1, $2, $3)",
          [familyId, tripId, input.name],
        );
        await db.query(
          "INSERT INTO family_members (trip_id, family_id, member_id, role) VALUES ($1, $2, $3, 'coordinator')",
          [tripId, familyId, memberId],
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
    const result = await db.query<Traveler>(
      `SELECT ${travelerColumns} FROM travelers WHERE trip_id = $1 AND family_id = $2 ORDER BY created_at, id`,
      [tripId, familyId],
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
        await db.query(
          `INSERT INTO travelers (id, trip_id, family_id, first_name, last_name) VALUES ($1, $2, $3, $4, $5)`,
          [id, tripId, familyId, input.firstName, input.lastName],
        );
      },
    );
    const result = await db.query<Traveler>(
      `SELECT ${travelerColumns} FROM travelers WHERE id = $1 AND trip_id = $2 AND family_id = $3`,
      [travelerId, tripId, familyId],
    );
    return { traveler: result.rows[0] };
  });
}
