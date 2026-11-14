import { groupDeletionInput } from "@nmt/contracts";
import { requireMember } from "../../../../../../src/permissions";
import { deleteOwnedGroup } from "../../../../../../src/membership";
import {
  invitationBody,
  invitationHttp,
} from "../../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
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
