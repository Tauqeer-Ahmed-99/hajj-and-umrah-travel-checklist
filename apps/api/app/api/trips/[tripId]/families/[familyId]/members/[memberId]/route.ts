import { familyMemberInput } from "@nmt/contracts";
import { requireMember } from "../../../../../../../../src/permissions";
import { changeFamilyMember } from "../../../../../../../../src/membership";
import {
  invitationBody,
  invitationHttp,
} from "../../../../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ tripId: string; familyId: string; memberId: string }>;
};
export async function PUT(request: Request, context: Context) {
  return invitationHttp(async () => {
    const actor = await requireMember(request);
    const { tripId, familyId, memberId } = await context.params;
    return changeFamilyMember(
      actor,
      tripId,
      familyId,
      memberId,
      (await invitationBody(request, familyMemberInput)).role,
    );
  });
}
export async function DELETE(request: Request, context: Context) {
  return invitationHttp(async () => {
    const actor = await requireMember(request);
    const { tripId, familyId, memberId } = await context.params;
    return changeFamilyMember(actor, tripId, familyId, memberId);
  });
}
