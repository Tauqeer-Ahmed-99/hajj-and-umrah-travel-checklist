import { guideInput, guideQuery } from "@nmt/contracts";
import { requireMember } from "../../../../../src/permissions";
import { readJson } from "../../../../../src/input";
import { failure, json } from "../../../../../src/response";
import { createGuide, listGuides } from "../../../../../src/guides";
import { guideParse } from "../../../../../src/guide-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    return json(
      await listGuides(
        await requireMember(request),
        (await context.params).tripId,
        guideParse(
          guideQuery,
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      ),
    );
  } catch (error) {
    return failure(error, "Guides could not be loaded. Reconnect and retry.");
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    return json(
      await createGuide(
        memberId,
        tripId,
        guideParse(guideInput, await readJson(request, "guide")),
      ),
      201,
    );
  } catch (error) {
    return failure(
      error,
      "Your save could not be confirmed. Retry the same guide save.",
    );
  }
}
