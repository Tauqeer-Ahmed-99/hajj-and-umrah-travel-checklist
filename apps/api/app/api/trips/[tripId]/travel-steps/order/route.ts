import { requireMember } from "../../../../../../src/permissions";
import { editJson } from "../../../../../../src/input";
import { failure, json } from "../../../../../../src/response";
import { travelStepOrder } from "@nmt/contracts";
import { orderTravelSteps } from "../../../../../../src/travel-plan";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ tripId: string }>;
};
export async function PUT(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId } = await context.params;
    return json(
      await orderTravelSteps(
        actor,
        tripId,
        await editJson(request, "travel", travelStepOrder),
      ),
    );
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
