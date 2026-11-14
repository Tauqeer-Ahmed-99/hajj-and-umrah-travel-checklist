import { z } from "zod";
import { overviewQuery } from "./overview";

// Device navigation hints are scoped to the authenticated member/session by the
// storage owner. They contain no trip content, search text, drafts or authority.
export const destinations = [
  "Overview",
  "Checklist",
  "Bags",
  "Guides",
] as const;
export const packingViews = [
  "bags",
  "items",
  "departure",
  "history",
  "review",
  "checkout",
] as const;
export const checklistViews = [
  "all",
  "shopping",
  "expectedDelivery",
  "overdueReceipt",
  "essentialOutstanding",
] as const;
export const tripNavigation = z.object({
  tripId: z.uuid(),
  destination: z.enum(destinations),
  view: z.enum(["overview-search", "completion"]).optional(),
  familyId: z.uuid().optional(),
  guideId: z.uuid().optional(),
  recordId: z.uuid().optional(),
  leg: z.enum(["outbound", "return"]).optional(),
  packingView: z.enum(packingViews).optional(),
  checklistView: z.enum(checklistViews).optional(),
  overview: overviewQuery.omit({ q: true }).optional(),
});
export type Destination = (typeof destinations)[number];
export type PackingView = (typeof packingViews)[number];
export type ChecklistView = (typeof checklistViews)[number];
export type TripNavigation = z.infer<typeof tripNavigation>;
