import { overviewQuery } from "@nmt/contracts";
import { requireMember } from "../../../../../../src/permissions";
import { readOverview } from "../../../../../../src/overview";
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
    const parsed = overviewQuery.safeParse({
      ...Object.fromEntries(params),
      leg: "return",
    });
    if (
      !parsed.success ||
      params.has("leg") ||
      [...params.keys()].some((k) => params.getAll(k).length !== 1)
    )
      throw new HttpError(
        422,
        "invalid_query",
        "Choose valid return overview filters.",
      );
    return json(
      await readOverview(member, (await context.params).tripId, parsed.data),
    );
  } catch (error) {
    return failure(
      error,
      "Could not refresh the return overview. Check your connection and retry.",
    );
  }
}
