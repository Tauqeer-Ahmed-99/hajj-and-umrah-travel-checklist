import { reminderInput } from "@nmt/contracts";
import { createReminder, readReminders } from "../../../../../src/reminders";
import {
  reminderBody,
  reminderHttp,
  type ReminderContext,
} from "../../../../../src/reminder-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: ReminderContext) {
  return reminderHttp(request, context, (actor, { tripId }) =>
    readReminders(actor, tripId),
  );
}
export function POST(request: Request, context: ReminderContext) {
  return reminderHttp(
    request,
    context,
    async (actor, { tripId }) =>
      createReminder(actor, tripId, await reminderBody(request, reminderInput)),
    201,
  );
}
