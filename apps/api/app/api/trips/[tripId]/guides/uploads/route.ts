import { fileGuideInput } from "@nmt/contracts";
import { beginFileGuide } from "../../../../../../src/guide-files";
import { requireMember } from "../../../../../../src/permissions";
import { failure, json } from "../../../../../../src/response";
import { readJson } from "../../../../../../src/input";
import { guideParse } from "../../../../../../src/guide-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    const input = guideParse(fileGuideInput, await readJson(request, "guide"));
    return json(await beginFileGuide(memberId, tripId, input), 201);
  } catch (error) {
    return failure(
      error,
      "The file request could not be confirmed. Reconnect and retry.",
    );
  }
}
