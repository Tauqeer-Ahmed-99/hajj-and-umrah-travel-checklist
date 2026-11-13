import { copyAccessInput } from "@nmt/contracts";
import { guideCopyAccess } from "../../../../../../../src/guides";
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
    const { version } = guideParse(
      copyAccessInput,
      await readJson(request, "guide"),
    );
    return json(await guideCopyAccess(memberId, tripId, guideId, version), 200);
  } catch (error) {
    return failure(
      error,
      "Guide access could not be checked. Reconnect and retry.",
    );
  }
}
