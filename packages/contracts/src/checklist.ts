import { z } from "zod";
import {
  acquisitionQuantity,
  acquisitionSnapshot,
  mutationDetails,
} from "./acquisition";
export * from "./acquisition";
export * from "./checklist-starters";

const title = z.string().trim().min(1, "Enter a name.").max(120);
const note = z.string().trim().max(800, "Use 800 characters or fewer.");
export const checklistBeneficiaries = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("family") }),
  z.strictObject({
    kind: z.literal("travelers"),
    travelerIds: z
      .array(z.uuid())
      .min(1, "Choose at least one traveler.")
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Choose each traveler once.",
      ),
  }),
]);
export const checklistPriority = z.enum(["essential", "high", "normal", "low"]);
export const checklistLeg = z.enum(["outbound", "return", "both"]);
export const checklistTaskStatus = z.enum([
  "to_do",
  "in_progress",
  "done",
  "not_needed",
]);
export const checklistTaskLabels: Record<
  z.infer<typeof checklistTaskStatus>,
  string
> = {
  to_do: "To do",
  in_progress: "In progress",
  done: "Done",
  not_needed: "Not needed",
};
const quantity = acquisitionQuantity.refine(
  (value) => value > 0,
  "Use a quantity greater than zero.",
);
export const checklistEntryFields = z.strictObject({
  categoryId: z.uuid(),
  title,
  requiredQuantity: quantity.nullable(),
  unit: z.string().trim().max(40),
  beneficiaries: checklistBeneficiaries,
  responsibleMemberId: z.uuid(),
  priority: checklistPriority,
  dueDate: z.iso.date().nullable(),
  notes: note,
  leg: checklistLeg,
  source: note,
  lastReviewedOn: z.iso.date().nullable(),
  taskStatus: checklistTaskStatus.nullable(),
});
export const checklistEntryInput = checklistEntryFields
  .extend({
    kind: z.enum(["item", "task"]),
    requestId: z.uuid().optional(),
    requiredQuantity: quantity.nullable().default(null),
    unit: z.string().trim().max(40).default(""),
    priority: checklistPriority.default("normal"),
    dueDate: z.iso.date().nullable().default(null),
    notes: note.default(""),
    leg: checklistLeg.default("outbound"),
    source: note.default(""),
    lastReviewedOn: z.iso.date().nullable().default(null),
    taskStatus: checklistTaskStatus.nullable().default(null),
  })
  .superRefine((entry, context) => {
    if (entry.kind === "item") {
      if (entry.requiredQuantity === null)
        context.addIssue({
          code: "custom",
          path: ["requiredQuantity"],
          message: "Enter the required quantity.",
        });
      if (!entry.unit)
        context.addIssue({
          code: "custom",
          path: ["unit"],
          message: "Enter a unit, for example sets or bottles.",
        });
      if (entry.taskStatus !== null)
        context.addIssue({
          code: "custom",
          path: ["taskStatus"],
          message: "Task progress belongs to a non-packing task.",
        });
    } else {
      if (entry.requiredQuantity !== null || entry.unit)
        context.addIssue({
          code: "custom",
          path: ["requiredQuantity"],
          message: "Tasks do not have stock quantities or units.",
        });
      if (entry.taskStatus === null)
        context.addIssue({
          code: "custom",
          path: ["taskStatus"],
          message: "Choose task progress.",
        });
    }
  });
export const checklistEntry = checklistEntryFields.extend({
  acquisition: acquisitionSnapshot.nullable(),
  id: z.uuid(),
  familyId: z.uuid(),
  kind: z.enum(["item", "task"]),
});
export const checklistEntryResponse = z.object({ entry: checklistEntry });
export const checklistEntryPatch = checklistEntryFields
  .partial()
  .extend(mutationDetails.shape)
  .refine(
    (value) =>
      Object.keys(value).some((key) => key !== "requestId" && key !== "reason"),
    "Change at least one field.",
  );
export const checklistCategoryInput = z.strictObject({
  name: title,
  requestId: z.uuid().optional(),
});
export const checklistCategory = z.object({
  id: z.uuid(),
  familyId: z.uuid(),
  name: z.string(),
});
export const checklistCategoryResponse = z.object({
  category: checklistCategory,
});
export const checklistSavedResponse = z.object({ saved: z.literal(true) });
export const checklistCategoryPatch = z.strictObject({ name: title });
export const checklistStarterInput = z.strictObject({
  kind: z.enum(["hajj", "umrah"]),
  requestId: z.uuid().optional(),
});
export const checklistStarterResponse = z.object({
  copyId: z.uuid(),
  categoryIds: z.array(z.uuid()),
  entryIds: z.array(z.uuid()),
});
export const checklistResponse = z.object({
  categories: z.array(checklistCategory),
  entries: z.array(checklistEntry),
  canEdit: z.boolean(),
});
export const acquisitionViewsResponse = z.object({
  shopping: z.array(checklistEntry),
  expectedDelivery: z.array(checklistEntry),
  overdueReceipt: z.array(checklistEntry),
  essentialOutstanding: z.array(checklistEntry),
  canEdit: z.boolean(),
  asOf: z.iso.date(),
});
export type AcquisitionViews = z.infer<typeof acquisitionViewsResponse>;
export const checklistHistoryResponse = z.object({
  history: z.array(
    z.object({
      id: z.uuid(),
      entityType: z.enum(["category", "entry"]),
      entityId: z.uuid(),
      action: z.enum(["created", "updated", "removed"]),
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
    }),
  ),
});
export type Checklist = z.infer<typeof checklistResponse>;
export type ChecklistEntry = z.infer<typeof checklistEntry>;
export type ChecklistEntryInput = z.infer<typeof checklistEntryInput>;
export type ChecklistCategoryInput = z.infer<typeof checklistCategoryInput>;
export type ChecklistCategory = z.infer<typeof checklistCategory>;
export type ChecklistEntryPatch = z.infer<typeof checklistEntryPatch>;
export type ChecklistHistory = z.infer<
  typeof checklistHistoryResponse
>["history"];
export type ChecklistStarterInput = z.infer<typeof checklistStarterInput>;
