import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "./database";
import {
  returnDispositionKinds,
  type ReturnItem,
  type ReturnPreparation,
  type ReturnPreparationInput,
} from "@nmt/contracts";
import { requireFamilyAccess } from "./permissions";
import { lockChecklist } from "./checklist";
import { createOnce, transaction } from "./trips";
import { recordPacking, invalidateDepartureChecks } from "./packing-events";
import { milli } from "./acquisition";
import { HttpError } from "./response";

const source = `CASE WHEN r.origin = 'destination' THEN
  CASE WHEN e.not_needed_reason IS NULL THEN e.bought + e.received + e.already_available ELSE 0 END
  ELSE r.source_quantity END`;
const columns = `r.entry_id AS "entryId", e.title,e.unit,r.origin,
 r.proposed_quantity::float8 AS "proposedQuantity", (${source})::float8 AS "sourceQuantity",
 r.required_quantity::float8 AS "requiredQuantity",r.possession_quantity::float8 AS "possessionQuantity",
 (r.reviewed_at IS NOT NULL) AS reviewed,to_char(r.reviewed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "reviewedAt",r.reviewed_by AS "reviewedBy",
 to_char(r.possession_confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "possessionConfirmedAt",r.possession_confirmed_by AS "possessionConfirmedBy",
 jsonb_build_object('quantity',r.consumed,'explanation',r.consumed_reason) AS consumed,
 jsonb_build_object('quantity',r.gifted,'explanation',r.gifted_reason) AS gifted,
 jsonb_build_object('quantity',r.left_quantity,'explanation',r.left_reason) AS left,
 jsonb_build_object('quantity',r.lost,'explanation',r.lost_reason) AS lost,
 (${source} - r.possession_quantity-r.consumed-r.gifted-r.left_quantity-r.lost)::float8 AS unaccounted,
 greatest(0,r.required_quantity-r.possession_quantity)::float8 AS "remainingToVerify",
 coalesce((SELECT jsonb_agg(jsonb_build_object('leg',a.leg,'quantity',a.quantity,'location',
   CASE WHEN a.bag_id IS NOT NULL THEN jsonb_build_object('kind','bag','id',a.bag_id)
   ELSE jsonb_build_object('kind','traveler','id',a.traveler_id) END) ORDER BY a.leg,a.bag_id,a.traveler_id)
   FROM packing_allocations a WHERE a.entry_id=r.entry_id AND a.family_id=r.family_id
   AND a.leg = CASE WHEN EXISTS(SELECT 1 FROM packing_items n WHERE n.entry_id=r.entry_id AND n.leg='return')
     THEN 'return' ELSE 'outbound' END),'[]') AS "lastConfirmedLocations"`;
export async function returnItems(
  db: DatabaseTransaction,
  familyId: string,
): Promise<ReturnItem[]> {
  // This projection is family-private. Sharing an item never authorizes its old locations.
  return (
    await db.execute<ReturnItem>(sql`SELECT ${sql.raw(columns)} FROM return_items r
    JOIN checklist_entries e ON e.id=r.entry_id WHERE r.family_id=${sql.param(familyId)}
    ORDER BY CASE WHEN e.priority='essential' THEN 0 ELSE 1 END,e.created_at,e.id`)
  ).rows;
}
async function state(
  db: DatabaseTransaction,
  familyId: string,
  canEdit: boolean,
): Promise<ReturnPreparation> {
  return {
    leg: "return",
    canEdit,
    items: await returnItems(db, familyId),
    checkout: (
      await db.execute<ReturnPreparation["checkout"][number]>(
        sql`SELECT id,label,checked,to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "checkedAt",checked_by AS "checkedBy" FROM return_checkout WHERE family_id=${sql.param(familyId)} ORDER BY area`,
      )
    ).rows,
  };
}
export function readReturnPreparation(
  memberId: string,
  tripId: string,
  familyId: string,
) {
  return transaction(async (db) => {
    const family = await requireFamilyAccess(db, memberId, tripId, familyId);
    await db.execute(
      sql`SELECT id FROM families WHERE id=${sql.param(familyId)} FOR SHARE`,
    );
    return state(db, familyId, family.canEdit);
  });
}
function conflict(message: string): never {
  throw new HttpError(409, "return_conflict", message);
}
export function mutateReturnPreparation(
  memberId: string,
  tripId: string,
  familyId: string,
  input: ReturnPreparationInput,
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
    await createOnce(
      db,
      memberId,
      `return-preparation:${tripId}:${familyId}`,
      input,
      async () => {
        if (input.kind === "propose") {
          const added = await db.execute<{
            entryId: string;
          }>(sql`INSERT INTO return_items
          (family_id,entry_id,origin,proposed_quantity,source_quantity,required_quantity)
          SELECT family_id,id,CASE WHEN leg='return' THEN 'destination' ELSE 'outbound' END,
          required_quantity,bought+received+already_available,required_quantity FROM checklist_entries
          WHERE family_id=${sql.param(familyId)} AND kind='item' AND removed_at IS NULL AND not_needed_reason IS NULL
          ON CONFLICT (entry_id) DO NOTHING RETURNING entry_id AS "entryId"`);
          for (const item of added.rows)
            await recordPacking(
              db,
              memberId,
              familyId,
              "return_proposed",
              [],
              { proposed: true, reviewed: false, possessionQuantity: 0 },
              {},
              { leg: "return", entryId: item.entryId },
            );
          await db.execute(sql`INSERT INTO bag_legs (family_id,bag_id,leg) SELECT family_id,id,'return' FROM bags
          WHERE family_id=${sql.param(familyId)} AND removed_at IS NULL ON CONFLICT DO NOTHING`);
          const checks = await db.execute<{
            id: string;
            label: string;
          }>(sql`INSERT INTO return_checkout (family_id,area,label) VALUES
          (${sql.param(familyId)},'rooms','Check all rooms'),(${sql.param(familyId)},'cupboards','Check cupboards'),(${sql.param(familyId)},'safes','Empty safes'),
          (${sql.param(familyId)},'charging_points','Check charging points') ON CONFLICT DO NOTHING RETURNING id,label`);
          for (const check of checks.rows)
            await recordPacking(
              db,
              memberId,
              familyId,
              "checkout_created",
              [],
              { checkId: check.id, label: check.label, checked: false },
              {},
              { leg: "return" },
            );
        } else if (input.kind === "checkout") {
          const found = await db.execute<
            ReturnPreparation["checkout"][number]
          >(sql`SELECT id,label,checked,to_char(checked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "checkedAt",checked_by AS "checkedBy"
          FROM return_checkout WHERE family_id=${sql.param(familyId)} AND id=${sql.param(input.checkId)}`);
          const current = found.rows[0];
          if (!current)
            throw new HttpError(
              404,
              "not_found",
              "This checkout task is not available to you.",
            );
          const next = {
            label: input.label ?? current.label,
            checked:
              input.checked ??
              (input.label !== undefined ? false : current.checked),
          };
          if (next.checked && !input.physicalConfirmed)
            throw new HttpError(
              422,
              "invalid_return",
              "Physically check this area before confirming checkout.",
            );
          if (next.label === current.label && next.checked === current.checked)
            return;
          await db.execute(sql`UPDATE return_checkout SET label=${sql.param(next.label)},checked=${sql.param(next.checked)},checked_at=CASE WHEN ${sql.param(next.checked)} THEN clock_timestamp() ELSE NULL END,
          checked_by=CASE WHEN ${sql.param(next.checked)} THEN ${sql.param(memberId)}::uuid ELSE NULL END WHERE id=${sql.param(input.checkId)}`);
          await recordPacking(
            db,
            memberId,
            familyId,
            "checkout_updated",
            [],
            { checkId: input.checkId, ...next },
            current,
            { leg: "return" },
          );
        } else {
          const current = (await returnItems(db, familyId)).find(
            (item) => item.entryId === input.entryId,
          );
          if (!current)
            throw new HttpError(
              404,
              "not_found",
              "Propose this item for return review first.",
            );
          const next = { ...current, ...input.fields };
          const sourceEntry = await db.execute(
            sql`SELECT id FROM checklist_entries WHERE id=${sql.param(input.entryId)} AND family_id=${sql.param(familyId)} AND removed_at IS NULL`,
          );
          if (
            !sourceEntry.rowCount &&
            (next.requiredQuantity > 0 || next.possessionQuantity > 0)
          )
            conflict(
              "This source item was removed. Its reconciliation history is retained; add a new destination requirement for new belongings.",
            );
          if (
            (!current.reviewed ||
              (input.fields.requiredQuantity !== undefined &&
                input.fields.requiredQuantity !== current.requiredQuantity)) &&
            !input.reviewConfirmed
          )
            throw new HttpError(
              422,
              "invalid_return",
              "Review the return requirement before confirming possession.",
            );
          if (
            input.fields.possessionQuantity !== undefined &&
            !input.physicalConfirmed
          )
            throw new HttpError(
              422,
              "invalid_return",
              "Confirm the current quantity physically in your possession.",
            );
          const accounted =
            milli(next.possessionQuantity) +
            returnDispositionKinds.reduce(
              (n, key) => n + milli(next[key].quantity),
              0,
            );
          if (accounted > milli(current.sourceQuantity))
            conflict(
              "Possession and dispositions exceed the source quantity. Correct the counts together.",
            );
          const allocated = await db.execute<{
            quantity: number;
          }>(sql`SELECT coalesce(sum(quantity),0)::float8 AS quantity FROM packing_allocations
          WHERE family_id=${sql.param(familyId)} AND entry_id=${sql.param(input.entryId)} AND leg='return'`);
          if (
            milli(allocated.rows[0].quantity) >
            Math.min(
              milli(next.requiredQuantity),
              milli(next.possessionQuantity),
            )
          )
            conflict(
              "Unpack the affected return quantity before reducing its requirement or possession.",
            );
          const updates: Record<string, unknown> = {};
          const fields: Record<string, string> = {
            requiredQuantity: "required_quantity",
            possessionQuantity: "possession_quantity",
          };
          for (const [key, value] of Object.entries(input.fields)) {
            if (key in fields) updates[fields[key]] = value;
            else {
              const disposition = value as ReturnItem["consumed"];
              updates[key === "left" ? "left_quantity" : key] =
                disposition.quantity;
              updates[`${key}_reason`] = disposition.explanation;
            }
          }
          const physical = input.fields.possessionQuantity !== undefined;
          await db.execute(
            sql`UPDATE return_items SET ${sql.join(
              [
                ...Object.entries(updates).map(
                  ([key, value]) =>
                    sql`${sql.identifier(key)}=${sql.param(value)}`,
                ),
                sql`reviewed_at=CASE WHEN ${!!input.reviewConfirmed} THEN clock_timestamp() ELSE reviewed_at END`,
                sql`reviewed_by=CASE WHEN ${!!input.reviewConfirmed} THEN ${memberId}::uuid ELSE reviewed_by END`,
                sql`possession_confirmed_at=CASE WHEN ${physical} THEN clock_timestamp() ELSE possession_confirmed_at END`,
                sql`possession_confirmed_by=CASE WHEN ${physical} THEN ${memberId}::uuid ELSE possession_confirmed_by END`,
              ],
              sql`, `,
            )} WHERE entry_id=${input.entryId}`,
          );
          await db.execute(
            sql`UPDATE packing_items SET repacking_quantity=least(repacking_quantity,${sql.param(
              Math.max(
                0,
                Math.min(
                  milli(next.requiredQuantity),
                  milli(next.possessionQuantity),
                ) - milli(allocated.rows[0].quantity),
              ) / 1000,
            )}::numeric) WHERE entry_id=${sql.param(input.entryId)} AND leg='return'`,
          );
          await invalidateDepartureChecks(
            db,
            memberId,
            familyId,
            input.entryId,
            [],
            false,
            "return",
          );
          await recordPacking(
            db,
            memberId,
            familyId,
            "return_reconciled",
            [],
            {
              ...input.fields,
              reason: input.reason,
              reviewConfirmed: !!input.reviewConfirmed,
              physicalConfirmed: physical,
            },
            current,
            { leg: "return", entryId: input.entryId },
          );
        }
      },
    );
    return state(db, familyId, true);
  });
}
