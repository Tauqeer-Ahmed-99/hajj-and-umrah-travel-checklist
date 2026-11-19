import { requireMember } from "../../../../../src/permissions";
import { editJson } from "../../../../../src/input";
import { failure, json } from "../../../../../src/response";
import { tripTipInput } from "@nmt/contracts";
import { createTripTip } from "../../../../../src/trip-updates";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ tripId: string }>;
};
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId } = await context.params;
    return json(
      await createTripTip(
        actor,
        tripId,
        await editJson(request, "tip", tripTipInput),
      ),
      201,
    );
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
