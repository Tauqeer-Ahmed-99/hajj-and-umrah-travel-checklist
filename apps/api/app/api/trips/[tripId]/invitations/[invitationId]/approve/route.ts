import { invitationApprovalInput } from "@nmt/contracts";
import { requireMember } from "../../../../../../../src/permissions";
import { approveInvitation } from "../../../../../../../src/invitations";
import {
  invitationBody,
  invitationHttp,
} from "../../../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string; invitationId: string }> },
) {
  return invitationHttp(async () => {
    const member = await requireMember(request);
    const { tripId, invitationId } = await context.params;
    const { scope } = await invitationBody(request, invitationApprovalInput);
    return approveInvitation(member, tripId, invitationId, scope);
  });
}
