import { itineraryOrderInput } from "@nmt/contracts";
import { requireMember } from "../../../../../../src/permissions";
import { readJson } from "../../../../../../src/input";
import { failure, HttpError, json } from "../../../../../../src/response";
import { orderItinerary } from "../../../../../../src/itinerary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    const parsed = itineraryOrderInput.safeParse(
      await readJson(request, "itinerary"),
    );
    if (!parsed.success)
      throw new HttpError(
        422,
        "invalid_itinerary",
        "List each itinerary entry once.",
      );
    return json(await orderItinerary(memberId, tripId, parsed.data.entryIds));
  } catch (error) {
    return failure(
      error,
      "The new order could not be confirmed. Refresh before retrying.",
    );
  }
}
