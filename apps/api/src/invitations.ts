import { sql } from "drizzle-orm";
import type { Invitation, InvitationInput } from "@nmt/contracts";
import type { DatabaseTransaction } from "./database";
import { database } from "./database";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { HttpError } from "./response";
import { createOnce, transaction } from "./trips";
import { lockAccountAccess, requireActiveMember } from "./account-access";

type Recipient = { id: string; email: string };
type InvitationRow = {
  id: string;
  trip_id: string;
  family_id: string | null;
  recipient_member_id: string | null;
  recipient_email: string | null;
  trip_role: "organizer" | "member" | "viewer";
  family_role: "coordinator" | "editor" | "viewer" | null;
  trip_approved_by: string | null;
  family_approved_by: string | null;
  revoked_at: string | null;
  consumed_at: string | null;
  expired: boolean;
};

// All access-management mutations take this first, before actual membership
// locks. Existing protected writes still serialize against updates/deletes of
// their FOR SHARE membership rows. No itinerary row or private content is locked.
export async function lockAccess(db: DatabaseTransaction, tripId: string) {
  resourceId(tripId);
  await lockAccountAccess(db);
  await db.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${sql.param(tripId)}, 5))`,
  );
}
const notFound = () =>
  new HttpError(404, "not_found", "This invitation is not available to you.");

async function view(
  db: Pick<DatabaseTransaction, "execute">,
  id: string,
  recipientId: string | null = null,
): Promise<Invitation> {
  const result = await db.execute<Invitation>(sql`
    SELECT i.id, json_build_object('id', t.id, 'name', t.name) AS trip,
      CASE WHEN f.id IS NULL THEN NULL ELSE json_build_object('id', f.id, 'name', f.name) END AS family,
      COALESCE('@' || m.username, 'Verified email recipient') AS recipient,
      i.trip_role AS "tripRole", i.family_role AS "familyRole",
      EXISTS (SELECT 1 FROM trip_members a WHERE a.trip_id = i.trip_id
        AND a.member_id = i.trip_approved_by AND a.role = 'organizer') AS "tripApproved",
      (i.family_id IS NULL OR EXISTS (SELECT 1 FROM trip_members b
        LEFT JOIN family_members a ON a.trip_id=b.trip_id AND a.member_id=b.member_id AND a.family_id=i.family_id
        WHERE b.trip_id=i.trip_id AND b.member_id=i.family_approved_by
        AND (b.role='organizer' OR (a.role='coordinator' AND b.role<>'viewer')))) AS "familyApproved",
      to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
      to_char(i.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "expiresAt",
      CASE WHEN i.consumed_at IS NOT NULL THEN 'accepted' WHEN i.revoked_at IS NOT NULL THEN 'revoked'
        WHEN EXISTS (SELECT 1 FROM access_removals r WHERE r.trip_id = i.trip_id AND r.member_id = ${sql.param(recipientId)}
          AND (r.scope = 'trip' OR r.scope = i.family_id::text) AND r.removed_at >= i.created_at) THEN 'revoked'
        WHEN i.expires_at <= clock_timestamp() THEN 'expired' ELSE 'pending' END AS status
    FROM invitations i JOIN trips t ON t.id = i.trip_id
    LEFT JOIN families f ON f.id = i.family_id LEFT JOIN members m ON m.id = i.recipient_member_id
    WHERE i.id = ${sql.param(id)}`);
  if (!result.rows[0]) throw notFound();
  return result.rows[0];
}

export async function createInvitation(
  memberId: string,
  tripId: string,
  input: InvitationInput,
) {
  return transaction(async (db) => {
    await lockAccess(db, tripId);
    const trip = await requireTripAccess(db, memberId, tripId);
    const family = input.familyId
      ? await requireFamilyAccess(
          db,
          memberId,
          tripId,
          input.familyId,
          trip.role === "organizer" ? "read" : "coordinate",
        )
      : null;
    if (!input.familyId)
      await requireTripAccess(db, memberId, tripId, "organize");
    const id = await createOnce(
      db,
      memberId,
      `invitation:${tripId}`,
      input,
      async (id) => {
        let recipientId: string | null = null;
        if (input.recipient.kind === "username") {
          const target = await db.execute<{ id: string }>(
            sql`SELECT id FROM members WHERE username = ${sql.param(input.recipient.value)} AND removal_started_at IS NULL`,
          );
          recipientId = target.rows[0]?.id ?? null;
          if (!recipientId)
            throw new HttpError(
              422,
              "recipient_unavailable",
              "Check the recipient's existing username.",
              { recipient: "No account has this username." },
            );
        }
        await db.execute(sql`INSERT INTO invitations (id, trip_id, family_id, recipient_member_id, recipient_email,
        trip_role, family_role, trip_approved_by, family_approved_by, created_by)
        VALUES (${sql.param(id)},${sql.param(tripId)},${sql.param(input.familyId ?? null)},${sql.param(recipientId)},${sql.param(input.recipient.kind === "email" ? input.recipient.value : null)},${sql.param(input.tripRole)},${sql.param(input.familyRole ?? null)},${sql.param(trip.role === "organizer" ? memberId : null)},${sql.param(family?.canCoordinate ? memberId : null)},${sql.param(memberId)})`);
      },
    );
    return { invitation: await view(db, id) };
  });
}

async function recipientRow(
  db: Pick<DatabaseTransaction, "execute">,
  recipient: Recipient,
  id: string,
) {
  resourceId(id);
  const result =
    await db.execute<InvitationRow>(sql`SELECT *, expires_at <= clock_timestamp() AS expired FROM invitations
    WHERE id = ${sql.param(id)} AND (consumed_by = ${sql.param(recipient.id)} OR (consumed_at IS NULL AND
      (recipient_member_id = ${sql.param(recipient.id)} OR recipient_email = ${sql.param(recipient.email)})))`);
  if (!result.rows[0]) throw notFound();
  return result.rows[0];
}
function requirePending(row: InvitationRow) {
  if (row.consumed_at || row.revoked_at || row.expired)
    throw new HttpError(
      409,
      "invitation_unavailable",
      "This invitation was accepted, revoked, or expired. Check your trips or request a new invitation.",
    );
}
export async function listManagedInvitations(memberId: string, tripId: string) {
  return transaction(async (db) => {
    const trip = await requireTripAccess(db, memberId, tripId);
    if (trip.role !== "organizer")
      await db.execute(sql`SELECT family_id FROM family_members
      WHERE trip_id = ${sql.param(tripId)} AND member_id = ${sql.param(memberId)} AND role = 'coordinator' FOR SHARE`);
    const rows = await db.execute<{
      id: string;
    }>(sql`SELECT i.id FROM invitations i WHERE i.trip_id = ${sql.param(tripId)} AND
      (${sql.param(trip.role)} = 'organizer' OR EXISTS (SELECT 1 FROM family_members fm WHERE fm.family_id = i.family_id
        AND fm.member_id = ${sql.param(memberId)} AND fm.role = 'coordinator' AND ${sql.param(trip.role)} <> 'viewer'))
      ORDER BY i.created_at DESC, i.id`);
    return {
      invitations: await Promise.all(rows.rows.map((row) => view(db, row.id))),
    };
  });
}

export async function approveInvitation(
  memberId: string,
  tripId: string,
  id: string,
  scope: "trip" | "family",
) {
  return transaction(async (db) => {
    await lockAccess(db, tripId);
    resourceId(id);
    await requireTripAccess(db, memberId, tripId);
    const result = await db.execute<InvitationRow>(
      sql`SELECT *, expires_at <= clock_timestamp() AS expired FROM invitations WHERE trip_id = ${sql.param(tripId)} AND id = ${sql.param(id)}`,
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    if (scope === "trip")
      await requireTripAccess(db, memberId, tripId, "organize");
    else {
      if (!row.family_id) throw notFound();
      await requireFamilyAccess(
        db,
        memberId,
        tripId,
        row.family_id,
        "coordinate",
      );
    }
    requirePending(row);
    await db.execute(
      scope === "trip"
        ? sql`UPDATE invitations SET trip_approved_by = ${sql.param(memberId)} WHERE id = ${sql.param(id)}`
        : sql`UPDATE invitations SET family_approved_by = ${sql.param(memberId)} WHERE id = ${sql.param(id)}`,
    );
    return { invitation: await view(db, id) };
  });
}

export async function revokeInvitation(
  memberId: string,
  tripId: string,
  id: string,
) {
  return transaction(async (db) => {
    await lockAccess(db, tripId);
    resourceId(id);
    const trip = await requireTripAccess(db, memberId, tripId);
    const result = await db.execute<InvitationRow>(
      sql`SELECT *, expires_at <= clock_timestamp() AS expired FROM invitations WHERE trip_id = ${sql.param(tripId)} AND id = ${sql.param(id)}`,
    );
    const row = result.rows[0];
    if (!row) throw notFound();
    if (trip.role !== "organizer") {
      if (!row.family_id) throw notFound();
      await requireFamilyAccess(
        db,
        memberId,
        tripId,
        row.family_id,
        "coordinate",
      );
    }
    if (row.consumed_at)
      throw new HttpError(
        409,
        "invitation_consumed",
        "This invitation has already been accepted. Remove membership access instead.",
      );
    await db.execute(
      sql`UPDATE invitations SET revoked_at = COALESCE(revoked_at, clock_timestamp()) WHERE id = ${sql.param(id)}`,
    );
    return { invitation: await view(db, id) };
  });
}
export async function previewInvitation(recipient: Recipient, id: string) {
  await recipientRow(database(), recipient, id);
  return { invitation: await view(database(), id, recipient.id) };
}
export async function listReceivedInvitations(recipient: Recipient) {
  const rows = await database().execute<{
    id: string;
  }>(sql`SELECT id FROM invitations WHERE consumed_by = ${sql.param(recipient.id)} OR (consumed_at IS NULL AND
      (recipient_member_id = ${sql.param(recipient.id)} OR recipient_email = ${sql.param(recipient.email)})) ORDER BY created_at DESC, id`);
  return {
    invitations: await Promise.all(
      rows.rows.map((row) => view(database(), row.id, recipient.id)),
    ),
  };
}
export async function acceptInvitation(recipient: Recipient, id: string) {
  return transaction(async (db) => {
    const initial = await recipientRow(db, recipient, id);
    await lockAccess(db, initial.trip_id);
    await requireActiveMember(db, recipient.id);
    const row = await recipientRow(db, recipient, id);
    requirePending(row);
    const removal =
      await db.execute(sql`SELECT 1 FROM access_removals r JOIN invitations i ON i.id = ${sql.param(id)}
      WHERE r.trip_id = i.trip_id AND r.member_id = ${sql.param(recipient.id)} AND (r.scope = 'trip' OR r.scope = ${sql.param(row.family_id)})
        AND r.removed_at >= i.created_at`);
    if (removal.rowCount)
      throw new HttpError(
        409,
        "access_removed",
        "Your access was removed after this offer. Ask for a newly approved invitation.",
      );
    const current = await view(db, id);
    if (!current.tripApproved || !current.familyApproved)
      throw new HttpError(
        409,
        "approvals_required",
        "Wait for the trip organizer and family coordinator to approve this invitation.",
      );
    // These same membership locks are used by every protected domain operation.
    await requireTripAccess(db, row.trip_approved_by!, row.trip_id, "organize");
    if (row.family_id)
      await requireFamilyAccess(
        db,
        row.family_approved_by!,
        row.trip_id,
        row.family_id,
        "coordinate",
      );
    const existingTrip = await db.execute<{ role: string }>(
      sql`SELECT role FROM trip_members WHERE trip_id = ${sql.param(row.trip_id)} AND member_id = ${sql.param(recipient.id)} FOR SHARE`,
    );
    if (existingTrip.rows[0] && existingTrip.rows[0].role !== row.trip_role)
      throw new HttpError(
        409,
        "existing_trip_role",
        "You already have different trip access. Ask an organizer to update it before accepting this invitation.",
      );
    if (row.family_id) {
      const existingFamily = await db.execute(
        sql`SELECT 1 FROM family_members WHERE family_id = ${sql.param(row.family_id)} AND member_id = ${sql.param(recipient.id)} FOR SHARE`,
      );
      if (existingFamily.rowCount)
        throw new HttpError(
          409,
          "existing_family_access",
          "You already belong to this family. Ask its coordinator to change your access.",
        );
    }
    await db.execute(sql`INSERT INTO trip_members (trip_id, member_id, role) VALUES (${sql.param(row.trip_id)},${sql.param(recipient.id)},${sql.param(row.trip_role)})
      ON CONFLICT (trip_id, member_id) DO NOTHING`);
    if (row.family_id)
      await db.execute(sql`INSERT INTO family_members (trip_id, family_id, member_id, role) VALUES (${sql.param(row.trip_id)},${sql.param(row.family_id)},${sql.param(recipient.id)},${sql.param(row.family_role)})
      ON CONFLICT (family_id, member_id) DO NOTHING`);
    // Use wall time after lock waits as well, so an expired offer cannot slip in.
    const consumed =
      await db.execute(sql`UPDATE invitations SET consumed_at = clock_timestamp(), consumed_by = ${sql.param(recipient.id)}
      WHERE id = ${sql.param(id)} AND expires_at > clock_timestamp() AND consumed_at IS NULL AND revoked_at IS NULL RETURNING id`);
    if (!consumed.rowCount)
      throw new HttpError(
        409,
        "invitation_unavailable",
        "This invitation has expired. Request a new one.",
      );
    return { tripId: row.trip_id };
  });
}
