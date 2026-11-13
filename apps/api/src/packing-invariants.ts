import type { PoolClient } from "pg";
import type { ChecklistEntry } from "@nmt/contracts";
import { milli, type QuantityPatch } from "./acquisition";
import { HttpError } from "./response";

// Every checklist/acquisition write uses the same family/membership locks as
// packing. Validation and any repacking adjustment commit with that write.
export async function preservePacking(
  db: PoolClient,
  familyId: string,
  current: ChecklistEntry,
  changes: QuantityPatch & { unit?: string; leg?: string; removed?: boolean },
) {
  if (!current.acquisition) return;
  const next = { ...current.acquisition, ...changes };
  const returns = await db.query<{
    origin: string;
    required: number;
    possession: number;
    accounted: number;
  }>(
    `SELECT origin,required_quantity::float8 AS required,
    possession_quantity::float8 AS possession,
    (possession_quantity+consumed+gifted+left_quantity+lost)::float8 AS accounted
    FROM return_items WHERE family_id=$1 AND entry_id=$2`,
    [familyId, current.id],
  );
  const returning = returns.rows[0];
  if (returning) {
    const structural =
      (changes.unit !== undefined && changes.unit !== current.unit) ||
      (changes.leg !== undefined && changes.leg !== current.leg);
    const inactive =
      changes.removed ||
      (returning.origin === "destination" && next.notNeededReason);
    const available = next.notNeededReason
      ? 0
      : milli(next.bought) +
        milli(next.received) +
        milli(next.alreadyAvailable);
    if (
      structural ||
      (inactive && (returning.required > 0 || returning.possession > 0)) ||
      (returning.origin === "destination" &&
        milli(returning.accounted) > available)
    )
      throw new HttpError(
        409,
        "return_conflict",
        "Reconcile return requirements, possession and dispositions before removing this item or reducing destination stock. Return records retain their original unit and leg.",
      );
  }
  const quantity = await db.query<{ allocated: number }>(
    `SELECT coalesce(sum(quantity),0)::float8 AS allocated FROM packing_allocations WHERE family_id = $1 AND entry_id = $2 AND leg = 'outbound'`,
    [familyId, current.id],
  );
  const allocated = milli(quantity.rows[0].allocated);
  const active =
    !changes.removed &&
    !next.notNeededReason &&
    (changes.leg ?? current.leg) !== "return";
  const available = active
    ? milli(next.bought) + milli(next.received) + milli(next.alreadyAvailable)
    : 0;
  const required = active
    ? milli(changes.requiredQuantity ?? current.requiredQuantity!)
    : 0;
  if (
    allocated > Math.min(available, required) ||
    (allocated > 0 &&
      changes.unit !== undefined &&
      changes.unit !== current.unit)
  )
    throw new HttpError(
      409,
      "packing_conflict",
      "Remove or move the allocated contents to Not packed before reducing availability, changing units/leg, marking Not needed or removing this item.",
    );
  // Removed quantities cease to need repacking if the available stock is reduced.
  await db.query(
    `UPDATE packing_items SET repacking_quantity = least(repacking_quantity,$3::numeric) WHERE family_id = $1 AND entry_id = $2 AND leg = 'outbound'`,
    [
      familyId,
      current.id,
      Math.max(0, Math.min(available, required) - allocated) / 1000,
    ],
  );
}
