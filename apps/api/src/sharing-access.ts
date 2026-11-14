import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "./database";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { HttpError } from "./response";

export type SharedTarget = { kind: "entry" | "bag"; id: string };
export async function lockSharedContent(
  db: DatabaseTransaction,
  memberId: string,
  tripId: string,
  familyId: string,
  target: SharedTarget,
) {
  await requireTripAccess(db, memberId, tripId, "edit");
  resourceId(familyId);
  resourceId(target.id);
  const family = await db.execute(
    sql`SELECT id FROM families WHERE id = ${sql.param(familyId)} AND trip_id = ${sql.param(tripId)} FOR UPDATE`,
  );
  if (!family.rowCount)
    throw new HttpError(
      404,
      "not_found",
      "This shared record is not available to you.",
    );
  const table = target.kind === "entry" ? "checklist_entries" : "bags";
  const record = await db.execute(
    sql`SELECT id FROM ${sql.raw(table)} WHERE id = ${sql.param(target.id)} AND family_id = ${sql.param(familyId)} AND audience = 'trip' AND removed_at IS NULL`,
  );
  if (!record.rowCount)
    throw new HttpError(
      404,
      "not_found",
      "This shared record is not available to you.",
    );
}
export async function sharingCapabilities(
  db: DatabaseTransaction,
  memberId: string,
  tripId: string,
  familyId: string,
) {
  const trip = await requireTripAccess(db, memberId, tripId);
  let canShare = false;
  try {
    canShare = (await requireFamilyAccess(db, memberId, tripId, familyId))
      .canCoordinate;
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 404)) throw error;
  }
  return { canEdit: trip.role !== "viewer", canShare };
}
