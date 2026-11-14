import { sql } from "drizzle-orm";
import type { DatabaseExecutor } from "./database";
import { trip as tripContract, type Family, type Trip } from "@nmt/contracts";
import { database } from "./database";
import { identify } from "./identity";
import { HttpError } from "./response";
import { removedAccount } from "./account-access";

export type PermissionDatabase = DatabaseExecutor;
export const tripColumns = `t.id, t.name, t.kind, t.start_date::text AS "startDate",
  t.end_date::text AS "endDate", t.destinations, tm.role`;

// Every protected trip operation resolves a completed application member from
// verified Clerk identity. Client-supplied member IDs never establish authority.
export async function requireMember(request: Request): Promise<string> {
  return (await requireMemberIdentity(request)).id;
}

export async function requireMemberIdentity(request: Request) {
  const identity = await identify(request);
  const result = await database().execute<{
    id: string;
    removal_started_at: string | null;
  }>(
    sql`SELECT id, removal_started_at FROM members WHERE clerk_user_id = ${sql.param(identity.clerkUserId)}`,
  );
  if (result.rows[0]?.removal_started_at) throw removedAccount();
  if (!result.rows[0])
    throw new HttpError(
      403,
      "profile_incomplete",
      "Complete your profile before opening a trip.",
    );
  return {
    id: result.rows[0].id,
    email: identity.email.trim().toLowerCase(),
    sessionId: identity.sessionId,
    clerkUserId: identity.clerkUserId,
  };
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
  const result = await db.execute<Trip>(sql`
    SELECT ${sql.raw(tripColumns)} FROM trips t
    JOIN trip_members tm ON tm.trip_id = t.id
    WHERE t.id = ${sql.param(tripId)} AND tm.member_id = ${sql.param(memberId)} FOR SHARE OF tm`);
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
  const result = await db.execute<Family>(sql`
    SELECT f.id, f.trip_id AS "tripId", f.name, fm.role,
      (fm.role <> 'viewer' AND ${sql.param(trip.role)} <> 'viewer') AS "canEdit",
      (fm.role = 'coordinator' AND ${sql.param(trip.role)} <> 'viewer') AS "canCoordinate"
    FROM families f JOIN family_members fm ON fm.family_id = f.id
    WHERE f.trip_id = ${sql.param(tripId)} AND f.id = ${sql.param(familyId)} AND fm.member_id = ${sql.param(memberId)} FOR SHARE OF fm`);
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
