import { openFileInput } from "@nmt/contracts";
import { openGuideFile } from "../../../../../../../src/guide-files";
import { requireMember } from "../../../../../../../src/permissions";
import { failure, json } from "../../../../../../../src/response";
import { readJson } from "../../../../../../../src/input";
import { guideParse } from "../../../../../../../src/guide-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string; guideId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId, guideId } = await context.params;
    const input = guideParse(openFileInput, await readJson(request, "guide"));
    return json(
      await openGuideFile(memberId, tripId, guideId, input.version),
      200,
    );
  } catch (error) {
    return failure(
      error,
      "The file request could not be confirmed. Reconnect and retry.",
    );
  }
}
