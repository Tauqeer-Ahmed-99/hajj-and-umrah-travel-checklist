import { z } from "zod";
import { acquisitionQuantity } from "./acquisition";
import { packingLocation } from "./packing";

export const returnDispositionKinds = [
  "consumed",
  "gifted",
  "left",
  "lost",
] as const;
const reason = z.string().trim().min(1).max(800);
export const returnDisposition = z
  .strictObject({
    quantity: acquisitionQuantity,
    explanation: z.string().trim().max(800),
  })
  .refine(
    (value) => value.quantity === 0 || value.explanation.length > 0,
    "Explain this disposition.",
  );
export const returnReconciliationFields = z
  .strictObject({
    requiredQuantity: acquisitionQuantity.optional(),
    possessionQuantity: acquisitionQuantity.optional(),
    consumed: returnDisposition.optional(),
    gifted: returnDisposition.optional(),
    left: returnDisposition.optional(),
    lost: returnDisposition.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Change at least one field.",
  );
export const returnPreparationInput = z.discriminatedUnion("kind", [
  z.strictObject({ requestId: z.uuid(), kind: z.literal("propose") }),
  z.strictObject({
    requestId: z.uuid(),
    kind: z.literal("reconcile"),
    entryId: z.uuid(),
    fields: returnReconciliationFields,
    reason,
    reviewConfirmed: z.boolean().optional(),
    physicalConfirmed: z.boolean().optional(),
  }),
  z
    .strictObject({
      requestId: z.uuid(),
      kind: z.literal("checkout"),
      checkId: z.uuid(),
      label: z.string().trim().min(1).max(120).optional(),
      checked: z.boolean().optional(),
      physicalConfirmed: z.boolean().optional(),
    })
    .refine(
      (value) => value.label !== undefined || value.checked !== undefined,
      "Change or confirm this checkout task.",
    ),
]);
export const returnItem = z.object({
  entryId: z.uuid(),
  title: z.string(),
  unit: z.string(),
  origin: z.enum(["outbound", "destination"]),
  proposedQuantity: z.number(),
  sourceQuantity: z.number(),
  requiredQuantity: z.number(),
  possessionQuantity: z.number(),
  reviewed: z.boolean(),
  reviewedAt: z.iso.datetime().nullable(),
  reviewedBy: z.uuid().nullable(),
  possessionConfirmedAt: z.iso.datetime().nullable(),
  possessionConfirmedBy: z.uuid().nullable(),
  consumed: returnDisposition,
  gifted: returnDisposition,
  left: returnDisposition,
  lost: returnDisposition,
  unaccounted: z.number(),
  remainingToVerify: z.number(),
  lastConfirmedLocations: z.array(
    z.object({
      leg: z.enum(["outbound", "return"]),
      location: packingLocation,
      quantity: z.number(),
    }),
  ),
});
export const returnPreparationResponse = z.object({
  leg: z.literal("return"),
  items: z.array(returnItem),
  canEdit: z.boolean(),
  checkout: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      checked: z.boolean(),
      checkedAt: z.iso.datetime().nullable(),
      checkedBy: z.uuid().nullable(),
    }),
  ),
});
export type ReturnPreparation = z.infer<typeof returnPreparationResponse>;
export type ReturnItem = z.infer<typeof returnItem>;
export type ReturnPreparationInput = z.infer<typeof returnPreparationInput>;
