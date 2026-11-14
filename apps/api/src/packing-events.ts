import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "./database";
import type { DepartureCheck, PackingMove } from "@nmt/contracts";

export async function recordPacking(
  db: DatabaseTransaction,
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
  await db.execute(sql`INSERT INTO packing_history (family_id, leg, bag_ids, action, actor, changes, entry_id, command, undoes, id)
    SELECT ${sql.param(familyId)},${sql.param(details.leg ?? "outbound")},${sql.param(bagIds)},${sql.param(action)},jsonb_build_object('id',id,'firstName',first_name,'lastName',last_name,'username',username),${sql.param(JSON.stringify(changes))},${sql.param(details.entryId ?? null)},${sql.param(details.command ? JSON.stringify(details.command) : null)},${sql.param(details.undoes ?? null)},coalesce(${sql.param(details.id ?? null)}::uuid,gen_random_uuid()) FROM members WHERE id = ${sql.param(memberId)}`);
}
export const checkColumns = `id, leg, label, entry_id AS "entryId", checked, to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "checkedAt", checked_by AS "checkedBy",
  CASE WHEN bag_id IS NOT NULL THEN jsonb_build_object('kind','bag','id',bag_id) WHEN traveler_id IS NOT NULL THEN jsonb_build_object('kind','traveler','id',traveler_id) ELSE NULL END AS location`;
export async function invalidateDepartureChecks(
  db: DatabaseTransaction,
  memberId: string,
  familyId: string,
  entryId: string | null,
  bagIds: string[] = [],
  clearLocation = false,
  leg: "outbound" | "return" = "outbound",
) {
  const checks =
    await db.execute<DepartureCheck>(sql`SELECT ${sql.raw(checkColumns)} FROM departure_checks WHERE family_id = ${sql.param(familyId)} AND leg = ${sql.param(leg)} AND removed_at IS NULL
    AND (entry_id = ${sql.param(entryId)}::uuid OR bag_id = ANY(${sql.param(bagIds)}::uuid[])) AND (checked OR ${sql.param(clearLocation)})`);
  for (const check of checks.rows) {
    const location =
      clearLocation &&
      check.location?.kind === "bag" &&
      bagIds.includes(check.location.id)
        ? null
        : check.location;
    await db.execute(
      sql`UPDATE departure_checks SET checked = false, checked_at = NULL, checked_by = NULL, bag_id = ${sql.param(location?.kind === "bag" ? location.id : null)} WHERE id = ${sql.param(check.id)}`,
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
