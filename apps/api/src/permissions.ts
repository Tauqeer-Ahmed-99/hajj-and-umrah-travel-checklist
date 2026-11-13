import type { PoolClient } from "pg";
import { trip as tripContract, type Family, type Trip } from "@nmt/contracts";
import { database } from "./database";
import { identify } from "./identity";
import { HttpError } from "./response";

export type PermissionDatabase = Pick<PoolClient, "query">;
export const tripColumns = `t.id, t.name, t.kind, t.start_date::text AS "startDate",
  t.end_date::text AS "endDate", t.destinations, tm.role`;

// Every protected trip operation resolves a completed application member from
// verified Clerk identity. Client-supplied member IDs never establish authority.
export async function requireMember(request: Request): Promise<string> {
  return (await requireMemberIdentity(request)).id;
}

export async function requireMemberIdentity(request: Request) {
  const identity = await identify(request);
  const result = await database().query<{ id: string }>(
    "SELECT id FROM members WHERE clerk_user_id = $1",
    [identity.clerkUserId],
  );
  if (!result.rows[0])
    throw new HttpError(
      403,
      "profile_incomplete",
      "Complete your profile before opening a trip.",
    );
  return { id: result.rows[0].id, email: identity.email.trim().toLowerCase() };
}

export function resourceId(value: string): string {
  if (!tripContract.shape.id.safeParse(value).success)
    throw new HttpError(
      404,
      "not_found",
      "This trip or family is not available to you.",
    );
  return value;
}

// Use the mutation's transaction client: the membership lock then lasts until
// commit, so a permission change cannot race an already authorized write.
export async function requireTripAccess(
  db: PermissionDatabase,
  memberId: string,
  tripId: string,
  capability: "read" | "edit" | "organize" = "read",
): Promise<Trip> {
  resourceId(tripId);
  const result = await db.query<Trip>(
    `
    SELECT ${tripColumns} FROM trips t
    JOIN trip_members tm ON tm.trip_id = t.id
    WHERE t.id = $1 AND tm.member_id = $2 FOR SHARE OF tm`,
    [tripId, memberId],
  );
  const trip = result.rows[0];
  if (!trip)
    throw new HttpError(
      404,
      "not_found",
      "This trip or family is not available to you.",
    );
  if (
    (capability === "organize" && trip.role !== "organizer") ||
    (capability === "edit" && trip.role === "viewer")
  )
    throw new HttpError(
      403,
      "trip_forbidden",
      "Your trip access does not allow this change.",
    );
  return trip;
}

export async function requireFamilyAccess(
  db: PermissionDatabase,
  memberId: string,
  tripId: string,
  familyId: string,
  capability: "read" | "edit" | "coordinate" = "read",
): Promise<Family> {
  const trip = await requireTripAccess(db, memberId, tripId);
  resourceId(familyId);
  const result = await db.query<Family>(
    `
    SELECT f.id, f.trip_id AS "tripId", f.name, fm.role,
      (fm.role <> 'viewer' AND $4 <> 'viewer') AS "canEdit",
      (fm.role = 'coordinator' AND $4 <> 'viewer') AS "canCoordinate"
    FROM families f JOIN family_members fm ON fm.family_id = f.id
    WHERE f.trip_id = $1 AND f.id = $2 AND fm.member_id = $3 FOR SHARE OF fm`,
    [tripId, familyId, memberId, trip.role],
  );
  const family = result.rows[0];
  if (!family)
    throw new HttpError(
      404,
      "not_found",
      "This trip or family is not available to you.",
    );
  if (
    (capability === "edit" && !family.canEdit) ||
    (capability === "coordinate" && !family.canCoordinate)
  )
    throw new HttpError(
      403,
      "family_forbidden",
      "Your family access does not allow this change.",
    );
  return family;
}
