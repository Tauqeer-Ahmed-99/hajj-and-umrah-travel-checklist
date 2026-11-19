import { requireMember } from "../../../../../src/permissions";
import { editJson } from "../../../../../src/input";
import { failure, json } from "../../../../../src/response";
import { travelAlertPreference } from "@nmt/contracts";
import {
  readTravelReminders,
  setTravelAlerts,
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
    return json(await readTravelReminders(actor, tripId));
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId } = await context.params;
    return json(
      await setTravelAlerts(
        actor,
        tripId,
        (await editJson(request, "travel", travelAlertPreference))
          .boardingEnabled,
      ),
    );
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
