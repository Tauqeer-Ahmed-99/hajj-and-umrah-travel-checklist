import { z } from "zod";

export const summaryTravelField = z.enum([
  "dates",
  "transport",
  "accommodation",
  "meeting",
  "contacts",
]);
export const summaryTravelLabels: Record<
  z.infer<typeof summaryTravelField>,
  string
> = {
  dates: "Travel dates and times",
  transport: "Transport references",
  accommodation: "Accommodation addresses",
  meeting: "Meeting points",
  contacts: "Travel contacts",
};
const ids = z
  .array(z.uuid())
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Choose each record once.",
  );
export const summarySelection = z
  .strictObject({
    tripDetails: z.boolean(),
    travelFields: z
      .array(summaryTravelField)
      .max(5)
      .refine(
        (values) => new Set(values).size === values.length,
        "Choose each field once.",
      ),
    itineraryEntryIds: ids,
    checklist: z
      .array(z.strictObject({ familyId: z.uuid(), entryIds: ids.min(1) }))
      .max(20)
      .refine(
        (values) =>
          new Set(values.map((value) => value.familyId)).size === values.length,
        "Choose each family once.",
      ),
    includePreparation: z.boolean(),
    includeTaskProgress: z.boolean(),
  })
  .refine(
    (value) =>
      value.checklist.length > 0 ||
      (value.travelFields.length > 0 &&
        (value.tripDetails || value.itineraryEntryIds.length > 0)),
    "Choose travel fields and their source, or checklist entries.",
  );
export const summaryPreview = z.strictObject({ text: z.string() });
export const summaryChoices = z.strictObject({
  itineraryEntries: z.array(
    z.strictObject({ id: z.uuid(), title: z.string() }),
  ),
  families: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      entries: z.array(
        z.strictObject({
          id: z.uuid(),
          title: z.string(),
          kind: z.enum(["item", "task"]),
        }),
      ),
    }),
  ),
});
export type SummaryChoices = z.infer<typeof summaryChoices>;
export type SummarySelection = z.infer<typeof summarySelection>;
export type SummaryPreview = z.infer<typeof summaryPreview>;
export type SummaryTravelField = z.infer<typeof summaryTravelField>;
