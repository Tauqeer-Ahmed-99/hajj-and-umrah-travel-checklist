import type { PoolClient } from "pg";
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
 (r.reviewed_at IS NOT NULL) AS reviewed,r.reviewed_at AS "reviewedAt",r.reviewed_by AS "reviewedBy",
 r.possession_confirmed_at AS "possessionConfirmedAt",r.possession_confirmed_by AS "possessionConfirmedBy",
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
  db: PoolClient,
  familyId: string,
): Promise<ReturnItem[]> {
  // This projection is family-private. Sharing an item never authorizes its old locations.
  return (
    await db.query<ReturnItem>(
      `SELECT ${columns} FROM return_items r
    JOIN checklist_entries e ON e.id=r.entry_id WHERE r.family_id=$1
    ORDER BY CASE WHEN e.priority='essential' THEN 0 ELSE 1 END,e.created_at,e.id`,
      [familyId],
    )
  ).rows;
}
async function state(
  db: PoolClient,
  familyId: string,
  canEdit: boolean,
): Promise<ReturnPreparation> {
  return {
    leg: "return",
    canEdit,
    items: await returnItems(db, familyId),
    checkout: (
      await db.query<ReturnPreparation["checkout"][number]>(
        `SELECT id,label,checked,checked_at AS "checkedAt",checked_by AS "checkedBy" FROM return_checkout WHERE family_id=$1 ORDER BY area`,
        [familyId],
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
    await db.query("SELECT id FROM families WHERE id=$1 FOR SHARE", [familyId]);
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
          const added = await db.query<{ entryId: string }>(
            `INSERT INTO return_items
          (family_id,entry_id,origin,proposed_quantity,source_quantity,required_quantity)
          SELECT family_id,id,CASE WHEN leg='return' THEN 'destination' ELSE 'outbound' END,
          required_quantity,bought+received+already_available,required_quantity FROM checklist_entries
          WHERE family_id=$1 AND kind='item' AND removed_at IS NULL AND not_needed_reason IS NULL
          ON CONFLICT (entry_id) DO NOTHING RETURNING entry_id AS "entryId"`,
            [familyId],
          );
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
          await db.query(
            `INSERT INTO bag_legs (family_id,bag_id,leg) SELECT family_id,id,'return' FROM bags
          WHERE family_id=$1 AND removed_at IS NULL ON CONFLICT DO NOTHING`,
            [familyId],
          );
          const checks = await db.query<{ id: string; label: string }>(
            `INSERT INTO return_checkout (family_id,area,label) VALUES
          ($1,'rooms','Check all rooms'),($1,'cupboards','Check cupboards'),($1,'safes','Empty safes'),
          ($1,'charging_points','Check charging points') ON CONFLICT DO NOTHING RETURNING id,label`,
            [familyId],
          );
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
          const found = await db.query<ReturnPreparation["checkout"][number]>(
            `SELECT id,label,checked,checked_at AS "checkedAt",checked_by AS "checkedBy"
          FROM return_checkout WHERE family_id=$1 AND id=$2`,
            [familyId, input.checkId],
          );
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
          await db.query(
            `UPDATE return_checkout SET label=$2,checked=$3,checked_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,
          checked_by=CASE WHEN $3 THEN $4::uuid ELSE NULL END WHERE id=$1`,
            [input.checkId, next.label, next.checked, memberId],
          );
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
          const allocated = await db.query<{ quantity: number }>(
            `SELECT coalesce(sum(quantity),0)::float8 AS quantity FROM packing_allocations
          WHERE family_id=$1 AND entry_id=$2 AND leg='return'`,
            [familyId, input.entryId],
          );
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
          const values = Object.values(updates);
          const physical = input.fields.possessionQuantity !== undefined;
          await db.query(
            `UPDATE return_items SET ${Object.keys(updates)
              .map((key, i) => `${key}=$${i + 3}`)
              .join(",")},
          reviewed_at=CASE WHEN $${values.length + 3} THEN clock_timestamp() ELSE reviewed_at END,
          reviewed_by=CASE WHEN $${values.length + 3} THEN $2::uuid ELSE reviewed_by END,
          possession_confirmed_at=CASE WHEN $${values.length + 4} THEN clock_timestamp() ELSE possession_confirmed_at END,
          possession_confirmed_by=CASE WHEN $${values.length + 4} THEN $2::uuid ELSE possession_confirmed_by END WHERE entry_id=$1`,
            [
              input.entryId,
              memberId,
              ...values,
              !!input.reviewConfirmed,
              physical,
            ],
          );
          await db.query(
            `UPDATE packing_items SET repacking_quantity=least(repacking_quantity,$2::numeric) WHERE entry_id=$1 AND leg='return'`,
            [
              input.entryId,
              Math.max(
                0,
                Math.min(
                  milli(next.requiredQuantity),
                  milli(next.possessionQuantity),
                ) - milli(allocated.rows[0].quantity),
              ) / 1000,
            ],
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
