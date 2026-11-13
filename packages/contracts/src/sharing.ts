import { z } from "zod";
import { checklistEntry, checklistEntryFields } from "./checklist";
import {
  bag,
  bagFields,
  packingItem,
  packingLocation,
  packingMove,
  packingEvent,
} from "./packing";

export const visibilityInput = z.strictObject({
  requestId: z.uuid(),
  audience: z.enum(["family", "trip"]),
});
export const sharedEntryPatch = checklistEntryFields
  .omit({ categoryId: true })
  .partial()
  .extend({
    beneficiaries: z
      .union([
        checklistEntryFields.shape.beneficiaries.options[0],
        checklistEntryFields.shape.beneficiaries.options[1],
      ])
      .optional(),
    requestId: z.uuid(),
    reason: z.string().trim().min(1).max(800).optional(),
  })
  .refine(
    (v) => Object.keys(v).some((k) => k !== "requestId" && k !== "reason"),
    "Change at least one field.",
  );
export const sharedBagPatch = bagFields
  .omit({ carrierTravelerId: true, identifyingNote: true })
  .partial()
  .extend({ requestId: z.uuid() })
  .refine(
    (v) => Object.keys(v).some((k) => k !== "requestId"),
    "Change at least one field.",
  );
export const sharedEntry = checklistEntry.omit({ categoryId: true }).extend({
  beneficiaries: z.union([
    checklistEntryFields.shape.beneficiaries.options[0],
    checklistEntryFields.shape.beneficiaries.options[1],
    z.strictObject({
      kind: z.literal("private"),
      label: z.literal("Private family beneficiaries"),
    }),
  ]),
});
export const sharedPackingItem = packingItem.extend({
  allocations: z.array(
    z.object({
      location: z.union([
        packingLocation.options[1],
        z.strictObject({
          kind: z.literal("private"),
          label: z.literal("Private carrying location"),
        }),
      ]),
      quantity: z.number(),
    }),
  ),
});
export const sharedBag = bag.omit({
  carrierTravelerId: true,
  identifyingNote: true,
});
export const sharedContentResponse = z.object({
  leg: z.enum(["outbound", "return"]),
  items: z.array(
    z.object({
      entry: sharedEntry,
      beneficiaryFamilies: z.array(
        z.object({ id: z.uuid(), name: z.string() }),
      ),
      packing: sharedPackingItem.nullable(),
      canEdit: z.boolean(),
      canShare: z.boolean(),
    }),
  ),
  bags: z.array(
    sharedBag.extend({ canEdit: z.boolean(), canShare: z.boolean() }),
  ),
  history: z.array(packingEvent),
});
export const sharedMove = packingMove.superRefine((input, ctx) => {
  if ([input.from, input.to].some((location) => location.kind === "traveler"))
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message:
        "Use a shared bag or Not packed. Private carrying locations are managed by the owning family.",
    });
});
export type SharedContent = z.infer<typeof sharedContentResponse>;
export type VisibilityInput = z.infer<typeof visibilityInput>;
export type SharedEntryPatch = z.infer<typeof sharedEntryPatch>;
export type SharedBagPatch = z.infer<typeof sharedBagPatch>;
