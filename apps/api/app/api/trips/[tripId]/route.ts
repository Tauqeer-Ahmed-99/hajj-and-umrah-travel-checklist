import { requireMember } from "../../../../src/permissions";
import { failure, json } from "../../../../src/response";
import { readTrip, transaction } from "../../../../src/trips";
import { groupDeletionInput, tripPatch } from "@nmt/contracts";
import { editJson } from "../../../../src/input";
import { editTrip } from "../../../../src/trip-editing";
import {
  invitationBody,
  invitationHttp,
} from "../../../../src/invitation-http";
import { deleteOwnedGroup } from "../../../../src/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const actor = await requireMember(request);
    return json(
      await editTrip(
        actor,
        (await context.params).tripId,
        await editJson(request, "trip", tripPatch),
      ),
    );
  } catch (error) {
    return failure(error, "The journey changes could not be saved. Try again.");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  return invitationHttp(async () =>
    deleteOwnedGroup(
      await requireMember(request),
      (await context.params).tripId,
      await invitationBody(request, groupDeletionInput),
    ),
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    return json(await transaction((db) => readTrip(db, memberId, tripId)));
  } catch (error) {
    return failure(
      error,
      "Your trip could not be loaded. Check your connection and try again.",
    );
  }
}
