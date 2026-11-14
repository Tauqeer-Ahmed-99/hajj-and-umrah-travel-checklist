import { overviewActivityQuery } from "@nmt/contracts";
import { requireMember } from "../../../../../../src/permissions";
import { readOverviewActivity } from "../../../../../../src/overview-activity";
import { failure, HttpError, json } from "../../../../../../src/response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const member = await requireMember(request);
    const params = new URL(request.url).searchParams;
    const parsed = overviewActivityQuery.safeParse(Object.fromEntries(params));
    if (
      !parsed.success ||
      [...params.keys()].some((k) => params.getAll(k).length !== 1)
    )
      throw new HttpError(
        422,
        "invalid_query",
        "Choose an item and travel leg for activity.",
      );
    return json(
      await readOverviewActivity(
        member,
        (await context.params).tripId,
        parsed.data.entryId,
        parsed.data.leg,
      ),
    );
  } catch (error) {
    return failure(
      error,
      "Could not refresh this item's activity. Check your connection and retry.",
    );
  }
}
