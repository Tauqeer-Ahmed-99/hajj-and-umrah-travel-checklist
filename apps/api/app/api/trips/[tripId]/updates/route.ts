import { requireMember } from "../../../../../src/permissions";
import { editJson } from "../../../../../src/input";
import { failure, json } from "../../../../../src/response";
import { readTripUpdates } from "../../../../../src/trip-updates";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ tripId: string }>;
};
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireMember(request);
    const { tripId } = await context.params;
    return json(await readTripUpdates(actor, tripId));
  } catch (error) {
    return failure(error, "We could not confirm this request. Try again.");
  }
}
