import { requireMember } from "../../../../../../../src/permissions";
import { failure, json } from "../../../../../../../src/response";
import { guideHistory } from "../../../../../../../src/guides";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string; guideId: string }> },
) {
  try {
    const memberId = await requireMember(request);
    const { tripId, guideId } = await context.params;
    return json(await guideHistory(memberId, tripId, guideId));
  } catch (error) {
    return failure(
      error,
      "Guide history could not be loaded. Reconnect and retry.",
    );
  }
}
