import { travelerPatch } from "@nmt/contracts";
import { editJson } from "../../../../../../../../src/input";
import { requireMember } from "../../../../../../../../src/permissions";
import { failure, json } from "../../../../../../../../src/response";
import { editTraveler } from "../../../../../../../../src/trip-editing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ tripId: string; familyId: string; travelerId: string }>;
  },
) {
  try {
    const actor = await requireMember(request),
      { tripId, familyId, travelerId } = await context.params;
    return json(
      await editTraveler(
        actor,
        tripId,
        familyId,
        travelerId,
        await editJson(request, "traveler", travelerPatch),
      ),
    );
  } catch (error) {
    return failure(
      error,
      "The traveler changes could not be saved. Try again.",
    );
  }
}
