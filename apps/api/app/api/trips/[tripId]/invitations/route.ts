import { invitationInput } from "@nmt/contracts";
import { requireMember } from "../../../../../src/permissions";
import {
  createInvitation,
  listManagedInvitations,
} from "../../../../../src/invitations";
import {
  invitationBody,
  invitationHttp,
} from "../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  return invitationHttp(async () =>
    listManagedInvitations(
      await requireMember(request),
      (await context.params).tripId,
    ),
  );
}
export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  return invitationHttp(async () => {
    const member = await requireMember(request);
    return createInvitation(
      member,
      (await context.params).tripId,
      await invitationBody(request, invitationInput),
    );
  }, 201);
}
