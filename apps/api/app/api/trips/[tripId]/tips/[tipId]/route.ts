import { requireMember } from "../../../../../../src/permissions";
import { editJson } from "../../../../../../src/input";
import { failure, json } from "../../../../../../src/response";
import { tripTipPatch } from "@nmt/contracts";
import {
  patchTripTip,
  removeTripTip,
} from "../../../../../../src/trip-updates";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ tripId: string; tipId: string }>;
};
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId, tipId } = await context.params;
    return json(
      await patchTripTip(
        actor,
        tripId,
        tipId,
        await editJson(request, "tip", tripTipPatch),
      ),
    );
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId, tipId } = await context.params;
    return json(await removeTripTip(actor, tripId, tipId));
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
