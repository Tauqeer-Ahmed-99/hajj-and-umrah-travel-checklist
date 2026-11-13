import { itineraryPatch } from "@nmt/contracts";
import { requireMember } from "../../../../../src/permissions";
import { readJson } from "../../../../../src/input";
import { failure, HttpError, json } from "../../../../../src/response";
import { patchItinerary, readItinerary } from "../../../../../src/itinerary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    return json(await readItinerary(memberId, tripId));
  } catch (error) {
    return failure(
      error,
      "Your itinerary could not be loaded. Reconnect and retry.",
    );
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    const parsed = itineraryPatch.safeParse(
      await readJson(request, "itinerary"),
    );
    if (!parsed.success)
      throw new HttpError(
        422,
        "invalid_itinerary",
        "Check the highlighted itinerary fields.",
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "form"),
            issue.message,
          ]),
        ),
      );
    return json(await patchItinerary(memberId, tripId, parsed.data));
  } catch (error) {
    return failure(
      error,
      "Your save could not be confirmed. Check the itinerary before retrying.",
    );
  }
}
