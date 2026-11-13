import { z } from "zod";
import { zonedDateTime } from "./itinerary";

export const reminderCategory = z.enum([
  "assignment",
  "expected_delivery",
  "departure_preparation",
  "return_packing",
]);
export const reminderCategoryLabels = {
  assignment: "Assignment",
  expected_delivery: "Expected delivery",
  departure_preparation: "Departure preparation",
  return_packing: "Return packing",
};
export const reminderInput = z.strictObject({
  requestId: z.uuid(),
  category: reminderCategory,
  title: z.string().trim().min(1).max(120),
  ownerMemberId: z.uuid(),
  dueAt: zonedDateTime,
  familyId: z.uuid().nullable().default(null),
  entryId: z.uuid().nullable().default(null),
});
export const reminder = reminderInput.omit({ requestId: true }).extend({
  id: z.uuid(),
  tripId: z.uuid(),
  createdBy: z.uuid(),
  dismissed: z.boolean(),
  needsReview: z.boolean(),
  version: z.number().int(),
});
export const remindersResponse = z.object({ reminders: z.array(reminder) });
export const reminderResponse = z.object({ reminder });
export const reminderPatch = reminderInput
  .pick({ title: true, dueAt: true })
  .partial()
  .extend({
    requestId: z.uuid().optional(),
    dismissed: z.boolean().optional(),
    reviewedVersion: z.number().int().positive().optional(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "requestId"),
    "Change at least one field.",
  );
export type ReminderPatch = z.infer<typeof reminderPatch>;
export type Reminder = z.infer<typeof reminder>;
export type ReminderInput = z.infer<typeof reminderInput>;
export const notificationPreferences = z.strictObject({
  assignments: z.boolean(),
  deadlines: z.boolean(),
  tripChanges: z.boolean(),
});
export const notificationPreferencesPatch = notificationPreferences
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const notificationDeviceInput = z.strictObject({
  deviceId: z.uuid(),
  token: z
    .string()
    .regex(/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/)
    .max(250),
  tripIds: z.array(z.uuid()).max(100),
  localSchedules: z
    .array(
      z.strictObject({ id: z.uuid(), version: z.number().int().positive() }),
    )
    .max(200),
});
export const notificationState = z.object({
  preferences: notificationPreferences,
  deliveries: z.array(
    z.object({
      kind: z.enum(["assignments", "deadlines", "tripChanges"]),
      state: z.string(),
    }),
  ),
});
export type NotificationPreferences = z.infer<typeof notificationPreferences>;
export type NotificationDeviceInput = z.infer<typeof notificationDeviceInput>;
