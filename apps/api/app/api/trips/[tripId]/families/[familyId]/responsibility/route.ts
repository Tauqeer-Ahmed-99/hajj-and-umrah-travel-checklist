import { responsibilityInput } from "@nmt/contracts";
import { requireMember } from "../../../../../../../src/permissions";
import { transferResponsibility } from "../../../../../../../src/membership";
import {
  invitationBody,
  invitationHttp,
} from "../../../../../../../src/invitation-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string; familyId: string }> },
) {
  return invitationHttp(async () => {
    const actor = await requireMember(request),
      { tripId, familyId } = await context.params;
    return transferResponsibility(
      actor,
      tripId,
      await invitationBody(request, responsibilityInput),
      familyId,
    );
  });
}
