import { groupDeletionInput, familyPatch } from "@nmt/contracts";
import { editJson } from "../../../../../../src/input";
import { editFamily } from "../../../../../../src/trip-editing";
import { failure, json } from "../../../../../../src/response";
import { requireMember } from "../../../../../../src/permissions";
import { deleteOwnedGroup } from "../../../../../../src/membership";
import {
  invitationBody,
  invitationHttp,
} from "../../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: Request,
  context: { params: Promise<{ tripId: string; familyId: string }> },
) {
  try {
    const actor = await requireMember(request),
      { tripId, familyId } = await context.params;
    return json(
      await editFamily(
        actor,
        tripId,
        familyId,
        await editJson(request, "family", familyPatch),
      ),
    );
  } catch (error) {
    return failure(error, "The family name could not be saved. Try again.");
  }
}
export async function DELETE(
  request: Request,
  context: { params: Promise<{ tripId: string; familyId: string }> },
) {
  return invitationHttp(async () => {
    const actor = await requireMember(request),
      { tripId, familyId } = await context.params;
    return deleteOwnedGroup(
      actor,
      tripId,
      await invitationBody(request, groupDeletionInput),
      familyId,
    );
  });
}
