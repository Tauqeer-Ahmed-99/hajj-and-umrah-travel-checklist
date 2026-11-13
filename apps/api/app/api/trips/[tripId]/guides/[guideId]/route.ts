import { guidePatch } from "@nmt/contracts";
import { requireMember } from "../../../../../../src/permissions";
import { failure, json } from "../../../../../../src/response";
import { readGuide, patchGuide } from "../../../../../../src/guides";
import { readJson } from "../../../../../../src/input";
import { guideParse } from "../../../../../../src/guide-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string; guideId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId, guideId } = await context.params;
    return json(await readGuide(memberId, tripId, guideId));
  } catch (error) {
    return failure(
      error,
      "This guide could not be loaded. Reconnect and retry.",
    );
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId, guideId } = await context.params;
    return json(
      await patchGuide(
        memberId,
        tripId,
        guideId,
        guideParse(guidePatch, await readJson(request, "guide")),
      ),
    );
  } catch (error) {
    return failure(
      error,
      "Your save could not be confirmed. Retry the same guide save.",
    );
  }
}
