import { emptyInput } from "@nmt/contracts";
import { requireMemberIdentity } from "../../../../../src/permissions";
import { acceptInvitation } from "../../../../../src/invitations";
import {
  invitationBody,
  invitationHttp,
} from "../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ invitationId: string }> },
) {
  return invitationHttp(async () => {
    const member = await requireMemberIdentity(request);
    await invitationBody(request, emptyInput);
    return acceptInvitation(member, (await context.params).invitationId);
  });
}
