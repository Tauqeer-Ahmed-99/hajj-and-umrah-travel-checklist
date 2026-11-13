import { requireMember } from "../../../../../src/permissions";
import { listMembers } from "../../../../../src/membership";
import { invitationHttp } from "../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  return invitationHttp(async () =>
    listMembers(await requireMember(request), (await context.params).tripId),
  );
}
