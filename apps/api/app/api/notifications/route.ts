import { notificationPreferencesPatch } from "@nmt/contracts";
import {
  readNotifications,
  patchNotifications,
} from "../../../src/notifications";
import { requireMember } from "../../../src/permissions";
import { reminderBody } from "../../../src/reminder-http";
import { failure, json } from "../../../src/response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return json(await readNotifications(await requireMember(request)));
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const actor = await requireMember(request);
    return json(
      await patchNotifications(
        actor,
        await reminderBody(request, notificationPreferencesPatch),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
