import { z } from "zod";
import { notificationDeviceInput } from "@nmt/contracts";
import { registerDevice, removeDevice } from "../../../../src/notifications";
import { requireMemberIdentity } from "../../../../src/permissions";
import { reminderBody } from "../../../../src/reminder-http";
import { failure, json } from "../../../../src/response";
export const runtime = "nodejs";
export async function PUT(request: Request) {
  try {
    const identity = await requireMemberIdentity(request);
    return json(
      await registerDevice(
        identity,
        await reminderBody(request, notificationDeviceInput),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
export async function DELETE(request: Request) {
  try {
    const identity = await requireMemberIdentity(request);
    const input = await reminderBody(
      request,
      z.strictObject({ deviceId: z.uuid() }),
    );
    return json(await removeDevice(identity.id, input.deviceId));
  } catch (error) {
    return failure(error);
  }
}
