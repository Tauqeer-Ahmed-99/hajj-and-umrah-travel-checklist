import { requireMember } from "../../../../../../src/permissions";
import { editJson } from "../../../../../../src/input";
import { failure, json } from "../../../../../../src/response";
import { travelStepPatch } from "@nmt/contracts";
import {
  patchTravelStep,
  removeTravelStep,
} from "../../../../../../src/travel-plan";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ tripId: string; stepId: string }>;
};
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId, stepId } = await context.params;
    return json(
      await patchTravelStep(
        actor,
        tripId,
        stepId,
        await editJson(request, "travel", travelStepPatch),
      ),
    );
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId, stepId } = await context.params;
    return json(await removeTravelStep(actor, tripId, stepId));
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
