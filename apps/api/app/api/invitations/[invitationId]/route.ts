import { requireMemberIdentity } from "../../../../src/permissions";
import { previewInvitation } from "../../../../src/invitations";
import { invitationHttp } from "../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ invitationId: string }> },
) {
  return invitationHttp(async () =>
    previewInvitation(
      await requireMemberIdentity(request),
      (await context.params).invitationId,
    ),
  );
}
