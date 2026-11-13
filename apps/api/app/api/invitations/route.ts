import { requireMemberIdentity } from "../../../src/permissions";
import { listReceivedInvitations } from "../../../src/invitations";
import { invitationHttp } from "../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return invitationHttp(async () =>
    listReceivedInvitations(await requireMemberIdentity(request)),
  );
}
