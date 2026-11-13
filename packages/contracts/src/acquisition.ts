import { z } from "zod";

export const acquisitionQuantity = z
  .number()
  .min(0)
  .max(1_000_000)
  .refine(
    (value) =>
      Math.abs(value * 1000 - Math.round(value * 1000)) <=
      Number.EPSILON * Math.abs(value * 1000) * 4,
    "Use up to three decimal places.",
  )
  .transform((value) => Math.round(value * 1000) / 1000);
export const acquisitionState = z.enum([
  "remaining",
  "ordered",
  "delivered",
  "bought",
  "received",
  "alreadyAvailable",
]);
export const acquisitionLabels: Record<
  z.infer<typeof acquisitionState>,
  string
> = {
  remaining: "Remaining",
  ordered: "Ordered",
  delivered: "Delivered",
  bought: "Bought",
  received: "Received",
  alreadyAvailable: "Already available",
};
export const acquisitionSnapshot = z.object({
  remaining: acquisitionQuantity,
  ordered: acquisitionQuantity,
  delivered: acquisitionQuantity,
  bought: acquisitionQuantity,
  received: acquisitionQuantity,
  alreadyAvailable: acquisitionQuantity,
  stillToArrange: acquisitionQuantity,
  awaitingReceipt: acquisitionQuantity,
  available: acquisitionQuantity,
  remainingToBeReady: acquisitionQuantity,
  expectedDeliveryDate: z.iso.date().nullable(),
  notNeededReason: z.string().nullable(),
});
export const acquisitionFields = z.strictObject({
  ordered: acquisitionQuantity.optional(),
  delivered: acquisitionQuantity.optional(),
  bought: acquisitionQuantity.optional(),
  received: acquisitionQuantity.optional(),
  alreadyAvailable: acquisitionQuantity.optional(),
  expectedDeliveryDate: z.iso.date().nullable().optional(),
  notNeededReason: z.string().trim().min(1).max(800).nullable().optional(),
  requiredQuantity: acquisitionQuantity.refine((value) => value > 0).optional(),
});
export const mutationDetails = z.strictObject({
  requestId: z.uuid().optional(),
  reason: z.string().trim().min(1).max(800).optional(),
});
export const acquisitionInput = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("move"),
    requestId: z.uuid(),
    from: acquisitionState,
    to: acquisitionState,
    quantity: acquisitionQuantity.refine(
      (value) => value > 0,
      "Enter a positive quantity.",
    ),
    physicalConfirmed: z.boolean().optional(),
    reason: z.string().trim().min(1).max(800).optional(),
  }),
  z.strictObject({
    kind: z.literal("correct"),
    requestId: z.uuid(),
    fields: acquisitionFields.refine(
      (fields) => Object.keys(fields).length > 0,
      "Change at least one field.",
    ),
    reason: z.string().trim().min(1).max(800).optional(),
    physicalConfirmed: z.boolean().optional(),
  }),
]);
export type AcquisitionInput = z.infer<typeof acquisitionInput>;
export type Acquisition = z.infer<typeof acquisitionSnapshot>;
