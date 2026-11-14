import { z } from "zod";

export const responsibilityInput = z.strictObject({
  targetMemberId: z.uuid(),
  requestId: z.uuid(),
});
export const groupDeletionInput = z.strictObject({
  confirmation: z.enum(["Delete family", "Delete trip"]),
  requestId: z.uuid(),
});
export const accountRemovalInput = z.strictObject({
  confirmation: z.literal("Remove my account"),
  requestId: z.uuid(),
});
export const accountRemovalResponse = z.object({
  state: z.enum(["active", "provider_pending", "completed"]),
  requestId: z.uuid().nullable(),
});
export type AccountRemoval = z.infer<typeof accountRemovalResponse>;
