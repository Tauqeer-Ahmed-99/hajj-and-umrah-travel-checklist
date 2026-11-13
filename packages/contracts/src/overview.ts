import { z } from "zod";
import { tripPhase, zonedDateTime } from "./itinerary";
import { packingEvent } from "./packing";

export const overviewAttention = z.enum([
  "essentials",
  "preparation",
  "placement",
  "tasks",
  "bags",
  "checks",
]);
export const overviewQuery = z.strictObject({
  scope: z.enum(["all", "mine", "family", "shared"]).default("all"),
  familyId: z.uuid().optional(),
  leg: z.enum(["outbound", "return"]).default("outbound"),
  q: z.string().trim().max(120).default(""),
  attention: overviewAttention.optional(),
});
export const overviewLocation = z.object({
  kind: z.enum(["bag", "traveler", "private"]),
  id: z.uuid().optional(),
  label: z.string(),
  quantity: z.number(),
});
export const overviewRecord = z.object({
  id: z.uuid(),
  kind: z.enum(["item", "task", "bag", "check"]),
  familyId: z.uuid(),
  familyName: z.string().nullable(),
  access: z.enum(["family", "shared"]),
  shared: z.boolean(),
  assignedToMe: z.boolean(),
  title: z.string(),
  leg: z.enum(["outbound", "return"]),
  priority: z.string().nullable(),
  status: z.string(),
  requiredQuantity: z.number().nullable(),
  available: z.number().nullable(),
  remainingToPrepare: z.number().nullable(),
  remainingToPlace: z.number().nullable(),
  unit: z.string(),
  locations: z.array(overviewLocation),
  confirmedAt: z.iso.datetime().nullable(),
  needsReview: z.boolean(),
  attention: z.array(overviewAttention),
});
const reference = overviewRecord.pick({ id: true, kind: true });
export const overviewResponse = z.object({
  query: overviewQuery,
  asOf: z.iso.datetime(),
  phase: tripPhase,
  nextDeparture: z
    .object({
      label: z.string(),
      date: z.iso.date(),
      precision: z.enum(["date", "time"]),
      at: zonedDateTime.nullable(),
      source: z.enum(["trip", "itinerary"]),
    })
    .nullable(),
  preparation: z.object({
    activeItems: z.number(),
    availableItems: z.number(),
    openTasks: z.number(),
  }),
  readiness: z.object({
    verification: z.literal("not_verified"),
    confirmedBags: z.number(),
    totalBags: z.number(),
    unknownOrReviewBags: z.number(),
  }),
  actions: z.array(
    z.object({
      key: overviewAttention,
      label: z.string(),
      count: z.number(),
      records: z.array(reference),
    }),
  ),
  records: z.array(overviewRecord),
});
export const overviewActivityResponse = z.object({
  entryId: z.uuid(),
  history: z.array(
    packingEvent.pick({
      id: true,
      actor: true,
      action: true,
      at: true,
      leg: true,
    }),
  ),
});
export const overviewActivityQuery = z.strictObject({
  entryId: z.uuid(),
  leg: z.enum(["outbound", "return"]).default("outbound"),
});
export type OverviewQuery = z.infer<typeof overviewQuery>;
export type OverviewRecord = z.infer<typeof overviewRecord>;
export type Overview = z.infer<typeof overviewResponse>;
export type OverviewActivity = z.infer<typeof overviewActivityResponse>;
