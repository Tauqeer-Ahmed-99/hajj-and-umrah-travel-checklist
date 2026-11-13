import type { AccessMember, FamilyRole, TripRole } from "@nmt/contracts";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { transaction } from "./trips";
import { lockAccess } from "./invitations";
import { HttpError } from "./response";

export async function listMembers(
  memberId: string,
  tripId: string,
  familyId?: string,
) {
  return transaction(async (db) => {
    if (familyId) await requireFamilyAccess(db, memberId, tripId, familyId);
    else await requireTripAccess(db, memberId, tripId);
    const people = await db.query<AccessMember>(
      familyId
        ? `SELECT m.id, m.first_name AS "firstName", m.last_name AS "lastName", m.username, fm.role
         FROM family_members fm JOIN members m ON m.id = fm.member_id WHERE fm.trip_id = $1 AND fm.family_id = $2 ORDER BY m.username`
        : `SELECT m.id, m.first_name AS "firstName", m.last_name AS "lastName", m.username, tm.role
         FROM trip_members tm JOIN members m ON m.id = tm.member_id WHERE tm.trip_id = $1 ORDER BY m.username`,
      familyId ? [tripId, familyId] : [tripId],
    );
    return { members: people.rows };
  });
}

export async function changeTripMember(
  actor: string,
  tripId: string,
  target: string,
  role?: TripRole,
) {
  return transaction(async (db) => {
    await lockAccess(db, tripId);
    resourceId(target);
    await requireTripAccess(
      db,
      actor,
      tripId,
      !role && target === actor ? "read" : "organize",
    );
    const existing = await db.query(
      "SELECT role FROM trip_members WHERE trip_id = $1 AND member_id = $2 FOR UPDATE",
      [tripId, target],
    );
    if (!existing.rows[0])
      throw new HttpError(404, "not_found", "This member is not in the trip.");
    if (existing.rows[0].role === "organizer" && role !== "organizer") {
      const others = await db.query(
        "SELECT 1 FROM trip_members WHERE trip_id = $1 AND member_id <> $2 AND role = 'organizer'",
        [tripId, target],
      );
      if (!others.rowCount)
        throw new HttpError(
          409,
          "last_organizer",
          "Assign another trip organizer before removing or reducing this organizer's access.",
        );
    }
    if (!role || role === "viewer") {
      const responsibilities = await db.query<{ family_id: string }>(
        "SELECT family_id FROM family_members WHERE trip_id = $1 AND member_id = $2 AND role = 'coordinator' FOR UPDATE",
        [tripId, target],
      );
      for (const family of responsibilities.rows) {
        const other = await db.query(
          `SELECT 1 FROM family_members fm JOIN trip_members tm ON tm.trip_id = fm.trip_id AND tm.member_id = fm.member_id
          WHERE fm.family_id = $1 AND fm.member_id <> $2 AND fm.role = 'coordinator' AND tm.role <> 'viewer'`,
          [family.family_id, target],
        );
        if (!other.rowCount)
          throw new HttpError(
            409,
            "last_coordinator",
            "Assign another family coordinator before removing this member's trip access.",
          );
      }
      if (role === "viewer" && responsibilities.rowCount)
        throw new HttpError(
          409,
          "coordinator_responsibility",
          "Transfer or reduce family coordinator responsibilities before making this member a trip viewer.",
        );
    }
    if (role)
      await db.query(
        "UPDATE trip_members SET role = $3 WHERE trip_id = $1 AND member_id = $2",
        [tripId, target, role],
      );
    else
      await db.query(
        "DELETE FROM trip_members WHERE trip_id = $1 AND member_id = $2",
        [tripId, target],
      );
    if (!role)
      await db.query(
        `INSERT INTO access_removals (trip_id, member_id, scope, removed_at)
      VALUES ($1,$2,'trip',clock_timestamp()) ON CONFLICT (trip_id, member_id, scope)
      DO UPDATE SET removed_at = EXCLUDED.removed_at`,
        [tripId, target],
      );
    if (role !== "organizer")
      await db.query(
        "UPDATE invitations SET trip_approved_by = NULL WHERE trip_id = $1 AND trip_approved_by = $2 AND consumed_at IS NULL",
        [tripId, target],
      );
    if (!role || role === "viewer")
      await db.query(
        "UPDATE invitations SET family_approved_by = NULL WHERE trip_id = $1 AND family_approved_by = $2 AND consumed_at IS NULL",
        [tripId, target],
      );
    return { saved: true };
  });
}

export async function changeFamilyMember(
  actor: string,
  tripId: string,
  familyId: string,
  target: string,
  role?: FamilyRole,
) {
  return transaction(async (db) => {
    await lockAccess(db, tripId);
    resourceId(target);
    await requireFamilyAccess(
      db,
      actor,
      tripId,
      familyId,
      !role && actor === target ? "read" : "coordinate",
    );
    const tripMember = await requireTripAccess(db, target, tripId);
    if (tripMember.role === "viewer" && role && role !== "viewer")
      throw new HttpError(
        409,
        "viewer_limit",
        "An organizer must grant trip edit access before family edit or coordinator access.",
      );
    const existing = await db.query(
      "SELECT role FROM family_members WHERE family_id = $1 AND member_id = $2 FOR UPDATE",
      [familyId, target],
    );
    if (existing.rows[0]?.role === "coordinator" && role !== "coordinator") {
      const other = await db.query(
        `SELECT 1 FROM family_members fm JOIN trip_members tm ON tm.trip_id = fm.trip_id AND tm.member_id = fm.member_id
        WHERE fm.family_id = $1 AND fm.member_id <> $2 AND fm.role = 'coordinator' AND tm.role <> 'viewer'`,
        [familyId, target],
      );
      if (!other.rowCount)
        throw new HttpError(
          409,
          "last_coordinator",
          "Assign another family coordinator before removing or reducing this coordinator's access.",
        );
    }
    if (role)
      await db.query(
        `INSERT INTO family_members (trip_id, family_id, member_id, role) VALUES ($1,$2,$3,$4)
      ON CONFLICT (family_id, member_id) DO UPDATE SET role = EXCLUDED.role`,
        [tripId, familyId, target, role],
      );
    else
      await db.query(
        "DELETE FROM family_members WHERE family_id = $1 AND member_id = $2",
        [familyId, target],
      );
    if (!role)
      await db.query(
        `INSERT INTO access_removals (trip_id, member_id, scope, removed_at)
      VALUES ($1,$2,$3,clock_timestamp()) ON CONFLICT (trip_id, member_id, scope)
      DO UPDATE SET removed_at = EXCLUDED.removed_at`,
        [tripId, target, familyId],
      );
    if (role !== "coordinator")
      await db.query(
        "UPDATE invitations SET family_approved_by = NULL WHERE family_id = $1 AND family_approved_by = $2 AND consumed_at IS NULL",
        [familyId, target],
      );
    return { saved: true };
  });
}
