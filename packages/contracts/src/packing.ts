import { z } from "zod";
import { acquisitionQuantity } from "./acquisition";

const name = z.string().trim().min(1, "Enter a name.").max(120);
const note = z.string().trim().max(800);
export const bagFields = z.strictObject({
  name,
  type: name,
  carrierTravelerId: z.uuid(),
  identifyingNote: note,
  weightNote: note,
  allowanceNote: note,
});
export const bagInput = bagFields.extend({
  requestId: z.uuid(),
  identifyingNote: note.default(""),
  weightNote: note.default(""),
  allowanceNote: note.default(""),
});
export const bagPatch = bagFields
  .partial()
  .extend({ requestId: z.uuid() })
  .refine(
    (input) => Object.keys(input).some((key) => key !== "requestId"),
    "Change at least one field.",
  );
export const bagStatus = z.enum([
  "packing",
  "ready",
  "in_transit",
  "collected",
]);
export const bagStatusLabels = {
  packing: "Packing",
  ready: "Ready",
  in_transit: "In transit",
  collected: "Collected",
} as const;
export const bagStateInput = z.strictObject({
  requestId: z.uuid(),
  leg: z.literal("outbound"),
  status: bagStatus,
  reviewConfirmed: z.boolean().optional(),
});
export const bag = bagFields.extend({
  id: z.uuid(),
  familyId: z.uuid(),
  legs: z.array(
    z.object({
      leg: z.enum(["outbound", "return"]),
      status: bagStatus,
      needsReview: z.boolean(),
      confirmedAt: z.iso.datetime().nullable(),
      confirmedBy: z.uuid().nullable(),
    }),
  ),
});
export const packingLocation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("unpacked") }),
  z.strictObject({ kind: z.literal("bag"), id: z.uuid() }),
  z.strictObject({ kind: z.literal("traveler"), id: z.uuid() }),
]);
export const packingMove = z.strictObject({
  requestId: z.uuid(),
  kind: z.literal("move"),
  leg: z.literal("outbound"),
  entryId: z.uuid(),
  from: packingLocation,
  to: packingLocation,
  quantity: acquisitionQuantity.refine(
    (n) => n > 0,
    "Enter a positive quantity.",
  ),
  physicalConfirmed: z.boolean().optional(),
  reason: note.min(1).optional(),
});
export const packingInput = z.discriminatedUnion("kind", [
  packingMove,
  z.strictObject({
    requestId: z.uuid(),
    kind: z.literal("undo"),
    leg: z.literal("outbound"),
    eventId: z.uuid(),
    reason: note.min(1),
    physicalConfirmed: z.boolean().optional(),
  }),
]);
export const packingItem = z.object({
  entryId: z.uuid(),
  title: z.string(),
  unit: z.string(),
  priority: z.enum(["essential", "high", "normal", "low"]),
  requiredQuantity: z.number(),
  available: z.number(),
  packed: z.number(),
  keptWithTraveler: z.number(),
  notPacked: z.number(),
  needsRepacking: z.number(),
  allocations: z.array(
    z.object({ location: packingLocation, quantity: z.number() }),
  ),
});
export const packingEvent = z.object({
  id: z.uuid(),
  leg: z.enum(["outbound", "return"]),
  entryId: z.uuid().nullable(),
  bagIds: z.array(z.uuid()),
  action: z.string(),
  at: z.iso.datetime(),
  actor: z.object({
    id: z.uuid(),
    firstName: z.string(),
    lastName: z.string(),
    username: z.string(),
  }),
  changes: z.record(
    z.string(),
    z.object({ before: z.unknown(), after: z.unknown() }),
  ),
  canUndo: z.boolean(),
});
const carryingLocation = z.union([
  packingLocation.options[1],
  packingLocation.options[2],
]);
const departureFields = z.strictObject({
  label: name,
  entryId: z.uuid().nullable(),
  location: carryingLocation.nullable(),
  checked: z.boolean(),
});
export const departureCheckInput = departureFields.extend({
  requestId: z.uuid(),
  entryId: z.uuid().nullable().default(null),
  location: carryingLocation.nullable().default(null),
  checked: z.boolean().default(false),
  physicalConfirmed: z.boolean().optional(),
});
export const departureCheckPatch = departureFields
  .partial()
  .extend({ requestId: z.uuid(), physicalConfirmed: z.boolean().optional() })
  .refine(
    (input) =>
      Object.keys(input).some(
        (key) => !["requestId", "physicalConfirmed"].includes(key),
      ),
    "Change at least one field.",
  );
export const packingRemoval = z.strictObject({
  requestId: z.uuid(),
  reason: note.min(1).optional(),
});
export const departureCheck = departureFields.extend({
  id: z.uuid(),
  leg: z.literal("outbound"),
  checkedAt: z.iso.datetime().nullable(),
  checkedBy: z.uuid().nullable(),
});
export const packingResponse = z.object({
  bags: z.array(bag),
  items: z.array(packingItem),
  checks: z.array(departureCheck),
  history: z.array(packingEvent),
  canEdit: z.boolean(),
});
export type Bag = z.infer<typeof bag>;
export type BagInput = z.infer<typeof bagInput>;
export type BagPatch = z.infer<typeof bagPatch>;
export type BagStateInput = z.infer<typeof bagStateInput>;
export type Packing = z.infer<typeof packingResponse>;
export type PackingLocation = z.infer<typeof packingLocation>;
export type PackingInput = z.infer<typeof packingInput>;
export type PackingMove = z.infer<typeof packingMove>;
export type PackingItem = z.infer<typeof packingItem>;
export type PackingEvent = z.infer<typeof packingEvent>;
export type DepartureCheck = z.infer<typeof departureCheck>;
export type DepartureCheckInput = z.infer<typeof departureCheckInput>;
export type DepartureCheckPatch = z.infer<typeof departureCheckPatch>;
export type PackingRemoval = z.infer<typeof packingRemoval>;
