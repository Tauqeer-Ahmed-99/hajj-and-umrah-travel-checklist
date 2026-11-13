import type { AcquisitionInput, ChecklistEntry } from "@nmt/contracts";
import { HttpError } from "./response";

// PostgreSQL numeric arithmetic produces exact JSON decimals; tasks have no inventory.
export const acquisitionColumns = `CASE WHEN kind = 'item' THEN jsonb_build_object(
  'ordered', ordered, 'delivered', delivered, 'bought', bought, 'received', received,
  'alreadyAvailable', already_available, 'expectedDeliveryDate', expected_delivery_date::text,
  'notNeededReason', not_needed_reason,
  'remaining', CASE WHEN not_needed_reason IS NULL THEN required_quantity ELSE 0 END - ordered - delivered - bought - received - already_available,
  'stillToArrange', CASE WHEN not_needed_reason IS NULL THEN required_quantity ELSE 0 END - ordered - delivered - bought - received - already_available,
  'awaitingReceipt', ordered + delivered, 'available', bought + received + already_available,
  'remainingToBeReady', CASE WHEN not_needed_reason IS NULL THEN required_quantity ELSE 0 END - bought - received - already_available
) ELSE NULL END AS acquisition`;

export const stockFields = {
  ordered: "ordered",
  delivered: "delivered",
  bought: "bought",
  received: "received",
  alreadyAvailable: "already_available",
} as const;
export const milli = (quantity: number) => Math.round(quantity * 1000);
const physical = (state: string) =>
  ["bought", "received", "alreadyAvailable"].includes(state);
export function invalidAcquisition(message: string, field = "form"): never {
  throw new HttpError(422, "invalid_acquisition", message, {
    [field]: message,
  });
}
export function moveQuantities(
  current: ChecklistEntry,
  input: Extract<AcquisitionInput, { kind: "move" }>,
) {
  const stock = current.acquisition;
  if (!stock) invalidAcquisition("Tasks do not have acquisition quantities.");
  if (stock.notNeededReason)
    invalidAcquisition("Restore the requirement before arranging quantities.");
  if (input.from === input.to)
    invalidAcquisition("Choose different preparation states.");
  if (milli(input.quantity) > milli(stock[input.from]))
    invalidAcquisition(
      "This quantity exceeds the current source quantity.",
      "quantity",
    );
  if (physical(input.to) && !input.physicalConfirmed)
    invalidAcquisition(
      "Confirm that this quantity is physically present and checked.",
      "physicalConfirmed",
    );
  if (
    !input.reason &&
    (physical(input.from) ||
      input.to === "remaining" ||
      !(
        input.from === "remaining" ||
        (input.from === "ordered" &&
          ["delivered", "received", "bought"].includes(input.to)) ||
        (input.from === "delivered" && input.to === "received")
      ))
  )
    invalidAcquisition(
      "Enter a reason for this correction, cancellation, rejection or return.",
      "reason",
    );
  return Object.fromEntries(
    [input.from, input.to]
      .filter((state) => state !== "remaining")
      .map((state) => [
        state,
        (milli(stock[state as keyof typeof stockFields]) +
          (state === input.to ? 1 : -1) * milli(input.quantity)) /
          1000,
      ]),
  );
}

export const acquisitionFields = {
  ...stockFields,
  expectedDeliveryDate: "expected_delivery_date",
  notNeededReason: "not_needed_reason",
  requiredQuantity: "required_quantity",
} as const;
export type QuantityPatch = Partial<
  Record<keyof typeof stockFields, number>
> & {
  requiredQuantity?: number;
  expectedDeliveryDate?: string | null;
  notNeededReason?: string | null;
};

// All item mutations (including the older checklist endpoints) meet here under
// the owning family lock, with the same transaction and permission locks.
// Checklist callers also run preservePacking against real outbound allocations
// before accepting availability/requirement changes or removing an entry.
export function validateAcquisition(
  current: ChecklistEntry,
  patch: QuantityPatch,
  details: { reason?: string; physicalConfirmed?: boolean },
  correction = false,
) {
  const stock = current.acquisition;
  if (!stock) invalidAcquisition("Tasks do not have acquisition quantities.");
  const next = { ...stock, ...patch };
  const required = patch.requiredQuantity ?? current.requiredQuantity!;
  const total = Object.keys(stockFields).reduce(
    (sum, key) => sum + milli(next[key as keyof typeof stockFields]),
    0,
  );
  if (total > (next.notNeededReason ? 0 : milli(required)))
    invalidAcquisition(
      "Quantities exceed the active requirement. Correct the affected quantities in the same save.",
    );
  const changed = Object.keys(stockFields).filter(
    (key) =>
      next[key as keyof typeof stockFields] !==
      stock[key as keyof typeof stockFields],
  );
  if (
    changed.some(
      (key) =>
        physical(key) &&
        milli(next[key as keyof typeof stockFields]) >
          milli(stock[key as keyof typeof stockFields]),
    ) &&
    !details.physicalConfirmed
  )
    invalidAcquisition(
      "Confirm that the additional quantity is physically present and checked.",
      "physicalConfirmed",
    );
  if (
    (milli(required) < milli(current.requiredQuantity!) ||
      (correction && changed.length > 0) ||
      (stock.notNeededReason && patch.notNeededReason === null)) &&
    !details.reason &&
    !patch.notNeededReason
  )
    invalidAcquisition(
      "Enter a reason for reducing or correcting this requirement.",
      "reason",
    );
}
