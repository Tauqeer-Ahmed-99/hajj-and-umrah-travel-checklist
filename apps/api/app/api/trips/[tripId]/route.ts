import { requireMember } from "../../../../src/permissions";
import { failure, json } from "../../../../src/response";
import { readTrip, transaction } from "../../../../src/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    return json(await transaction((db) => readTrip(db, memberId, tripId)));
  } catch (error) {
    return failure(
      error,
      "Your trip could not be loaded. Check your connection and try again.",
    );
  }
}
