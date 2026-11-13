import { reminderPatch } from "@nmt/contracts";
import { patchReminder } from "../../../../../../src/reminders";
import {
  reminderBody,
  reminderHttp,
  type ReminderContext,
} from "../../../../../../src/reminder-http";
export const runtime = "nodejs";
export function PATCH(request: Request, context: ReminderContext) {
  return reminderHttp(request, context, async (actor, { tripId, reminderId }) =>
    patchReminder(
      actor,
      tripId,
      reminderId!,
      await reminderBody(request, reminderPatch),
    ),
  );
}
