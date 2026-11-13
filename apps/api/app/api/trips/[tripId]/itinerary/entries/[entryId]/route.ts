import { itineraryEntryPatch } from "@nmt/contracts";
import { requireMember } from "../../../../../../../src/permissions";
import { readJson } from "../../../../../../../src/input";
import { failure, HttpError, json } from "../../../../../../../src/response";
import {
  deleteItineraryEntry,
  patchItineraryEntry,
} from "../../../../../../../src/itinerary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string; entryId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId, entryId } = await context.params;
    const parsed = itineraryEntryPatch.safeParse(
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
    return json(
      await patchItineraryEntry(memberId, tripId, entryId, parsed.data),
    );
  } catch (error) {
    return failure(
      error,
      "Your save could not be confirmed. Check the itinerary before retrying.",
    );
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId, entryId } = await context.params;
    return json(await deleteItineraryEntry(memberId, tripId, entryId));
  } catch (error) {
    return failure(
      error,
      "Removal could not be confirmed. Refresh the itinerary before retrying.",
    );
  }
}
