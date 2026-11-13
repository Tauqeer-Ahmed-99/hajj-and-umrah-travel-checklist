import { requireMember } from "../../../../../../../src/permissions";
import { listMembers } from "../../../../../../../src/membership";
import { invitationHttp } from "../../../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string; familyId: string }> },
) {
  return invitationHttp(async () => {
    const actor = await requireMember(request);
    const { tripId, familyId } = await context.params;
    return listMembers(actor, tripId, familyId);
  });
}
