import { tripMemberInput } from "@nmt/contracts";
import { requireMember } from "../../../../../../src/permissions";
import { changeTripMember } from "../../../../../../src/membership";
import {
  invitationBody,
  invitationHttp,
} from "../../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string; memberId: string }> };
export async function PUT(request: Request, context: Context) {
  return invitationHttp(async () => {
    const actor = await requireMember(request);
    const { tripId, memberId } = await context.params;
    return changeTripMember(
      actor,
      tripId,
      memberId,
      (await invitationBody(request, tripMemberInput)).role,
    );
  });
}
export async function DELETE(request: Request, context: Context) {
  return invitationHttp(async () => {
    const actor = await requireMember(request);
    const { tripId, memberId } = await context.params;
    return changeTripMember(actor, tripId, memberId);
  });
}
