import { z } from "zod";
import { tripPhase } from "./itinerary";
import { trip } from "./trips";
import { bagStatus } from "./packing";

export const completionInput = z.discriminatedUnion("kind", [
  z.strictObject({
    requestId: z.uuid(),
    kind: z.literal("complete"),
    reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
    travelConfirmed: z.literal(true),
  }),
  z.strictObject({
    requestId: z.uuid(),
    kind: z.literal("lesson"),
    text: z.string().trim().min(1).max(3000),
  }),
  z.strictObject({
    requestId: z.uuid(),
    kind: z.literal("archive"),
    archiveConfirmed: z.literal(true),
  }),
]);
export const completionResponse = z.object({
  tripId: z.uuid(),
  phase: tripPhase,
  canEdit: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  completedBy: z.uuid().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  archivedBy: z.uuid().nullable(),
  lessons: z.array(
    z.object({
      id: z.uuid(),
      text: z.string(),
      at: z.iso.datetime(),
      actor: z.string(),
    }),
  ),
  history: z.array(
    z.object({
      id: z.uuid(),
      action: z.enum([
        "completed",
        "phase_corrected",
        "lesson_added",
        "archived",
      ]),
      at: z.iso.datetime(),
      actor: z.string(),
    }),
  ),
});
export const completionReviewResponse = z.object({
  scope: z.literal("permitted_records_only"),
  phase: tripPhase,
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  bags: z.array(
    z.object({
      id: z.uuid(),
      familyId: z.uuid(),
      name: z.string(),
      status: bagStatus.nullable(),
      needsReview: z.boolean(),
      confirmedAt: z.iso.datetime().nullable(),
    }),
  ),
  items: z.array(
    z.object({
      entryId: z.uuid(),
      familyId: z.uuid(),
      title: z.string(),
      unit: z.string(),
      verification: z.enum(["unverified", "reviewed", "limited"]),
      possessionConfirmedAt: z.iso.datetime().nullable(),
      requiredQuantity: z.number().nullable(),
      possessionQuantity: z.number().nullable(),
      unaccounted: z.number().nullable(),
      remainingToVerify: z.number().nullable(),
      lostQuantity: z.number().nullable(),
    }),
  ),
});
export type Completion = z.infer<typeof completionResponse>;
export type CompletionReview = z.infer<typeof completionReviewResponse>;
export type CompletionInput = z.infer<typeof completionInput>;
export const archivesResponse = z.object({
  archives: z.array(z.object({ trip, archivedAt: z.iso.datetime() })),
});
