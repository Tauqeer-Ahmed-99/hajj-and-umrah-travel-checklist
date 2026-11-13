import type { PoolClient } from "pg";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { HttpError } from "./response";

export type SharedTarget = { kind: "entry" | "bag"; id: string };
export async function lockSharedContent(
  db: PoolClient,
  memberId: string,
  tripId: string,
  familyId: string,
  target: SharedTarget,
) {
  await requireTripAccess(db, memberId, tripId, "edit");
  resourceId(familyId);
  resourceId(target.id);
  const family = await db.query(
    "SELECT id FROM families WHERE id = $1 AND trip_id = $2 FOR UPDATE",
    [familyId, tripId],
  );
  if (!family.rowCount)
    throw new HttpError(
      404,
      "not_found",
      "This shared record is not available to you.",
    );
  const table = target.kind === "entry" ? "checklist_entries" : "bags";
  const record = await db.query(
    `SELECT id FROM ${table} WHERE id = $1 AND family_id = $2 AND audience = 'trip' AND removed_at IS NULL`,
    [target.id, familyId],
  );
  if (!record.rowCount)
    throw new HttpError(
      404,
      "not_found",
      "This shared record is not available to you.",
    );
}
export async function sharingCapabilities(
  db: PoolClient,
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
