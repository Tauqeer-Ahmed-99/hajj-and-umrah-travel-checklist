import { requireMember } from "../../../../../src/permissions";
import { editJson } from "../../../../../src/input";
import { failure, json } from "../../../../../src/response";
import { travelStepInput } from "@nmt/contracts";
import {
  readTravelSteps,
  createTravelStep,
} from "../../../../../src/travel-plan";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ tripId: string }>;
};
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId } = await context.params;
    return json(await readTravelSteps(actor, tripId));
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId } = await context.params;
    return json(
      await createTravelStep(
        actor,
        tripId,
        await editJson(request, "travel", travelStepInput),
      ),
      201,
    );
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
