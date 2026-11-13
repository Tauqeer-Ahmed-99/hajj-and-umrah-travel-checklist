import type { PoolClient } from "pg";
import type { DepartureCheck, PackingMove } from "@nmt/contracts";

export async function recordPacking(
  db: PoolClient,
  memberId: string,
  familyId: string,
  action: string,
  bagIds: string[],
  after: object,
  before: object = {},
  details: {
    leg?: "outbound" | "return";
    entryId?: string;
    command?: PackingMove;
    undoes?: string;
    id?: string;
  } = {},
) {
  const previous = before as Record<string, unknown>;
  const changes = Object.fromEntries(
    Object.entries(after)
      .filter(
        ([key, value]) =>
          JSON.stringify(value) !== JSON.stringify(previous[key]),
      )
      .map(([key, value]) => [
        key,
        { before: previous[key] ?? null, after: value },
      ]),
  );
  if (!Object.keys(changes).length) return;
  await db.query(
    `INSERT INTO packing_history (family_id, leg, bag_ids, action, actor, changes, entry_id, command, undoes, id)
    SELECT $1,$10,$2,$3,jsonb_build_object('id',id,'firstName',first_name,'lastName',last_name,'username',username),$5,$6,$7,$8,coalesce($9::uuid,gen_random_uuid()) FROM members WHERE id = $4`,
    [
      familyId,
      bagIds,
      action,
      memberId,
      JSON.stringify(changes),
      details.entryId ?? null,
      details.command ? JSON.stringify(details.command) : null,
      details.undoes ?? null,
      details.id ?? null,
      details.leg ?? "outbound",
    ],
  );
}
export const checkColumns = `id, leg, label, entry_id AS "entryId", checked, checked_at AS "checkedAt", checked_by AS "checkedBy",
  CASE WHEN bag_id IS NOT NULL THEN jsonb_build_object('kind','bag','id',bag_id) WHEN traveler_id IS NOT NULL THEN jsonb_build_object('kind','traveler','id',traveler_id) ELSE NULL END AS location`;
export async function invalidateDepartureChecks(
  db: PoolClient,
  memberId: string,
  familyId: string,
  entryId: string | null,
  bagIds: string[] = [],
  clearLocation = false,
  leg: "outbound" | "return" = "outbound",
) {
  const checks = await db.query<DepartureCheck>(
    `SELECT ${checkColumns} FROM departure_checks WHERE family_id = $1 AND leg = $5 AND removed_at IS NULL
    AND (entry_id = $2::uuid OR bag_id = ANY($3::uuid[])) AND (checked OR $4)`,
    [familyId, entryId, bagIds, clearLocation, leg],
  );
  for (const check of checks.rows) {
    const location =
      clearLocation &&
      check.location?.kind === "bag" &&
      bagIds.includes(check.location.id)
        ? null
        : check.location;
    await db.query(
      `UPDATE departure_checks SET checked = false, checked_at = NULL, checked_by = NULL, bag_id = $2 WHERE id = $1`,
      [check.id, location?.kind === "bag" ? location.id : null],
    );
    await recordPacking(
      db,
      memberId,
      familyId,
      "departure_check_invalidated",
      check.location?.kind === "bag" ? [check.location.id] : [],
      { checkId: check.id, label: check.label, checked: false, location },
      { checked: check.checked, location: check.location },
      { leg, entryId: check.entryId ?? undefined },
    );
  }
}
