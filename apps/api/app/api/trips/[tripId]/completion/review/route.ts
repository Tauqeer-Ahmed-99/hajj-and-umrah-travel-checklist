import { requireMember } from "../../../../../../src/permissions";
import { failure, json } from "../../../../../../src/response";
import { readCompletionReview } from "../../../../../../src/completion";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    return json(await readCompletionReview(memberId, tripId));
  } catch (error) {
    return failure(
      error,
      "Arrival review could not be loaded. Reconnect and retry.",
    );
  }
}
