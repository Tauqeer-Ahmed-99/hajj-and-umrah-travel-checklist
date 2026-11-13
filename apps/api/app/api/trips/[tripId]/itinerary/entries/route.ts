import { itineraryEntryInput } from "@nmt/contracts";
import { requireMember } from "../../../../../../src/permissions";
import { readJson } from "../../../../../../src/input";
import { failure, HttpError, json } from "../../../../../../src/response";
import { createItineraryEntry } from "../../../../../../src/itinerary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    const parsed = itineraryEntryInput.safeParse(
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
    return json(await createItineraryEntry(memberId, tripId, parsed.data), 201);
  } catch (error) {
    return failure(
      error,
      "Your save could not be confirmed. Check the itinerary before retrying.",
    );
  }
}
