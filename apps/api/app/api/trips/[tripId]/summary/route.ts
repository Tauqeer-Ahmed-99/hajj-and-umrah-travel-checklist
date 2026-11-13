import { summarySelection } from "@nmt/contracts";
import { requireMember } from "../../../../../src/permissions";
import { readJson } from "../../../../../src/input";
import { failure, HttpError, json } from "../../../../../src/response";
import {
  previewSummary,
  readSummaryChoices,
} from "../../../../../src/summaries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    return json(await readSummaryChoices(memberId, tripId));
  } catch (error) {
    return failure(
      error,
      "Could not load summary choices. Reconnect and retry.",
    );
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    const parsed = summarySelection.safeParse(
      await readJson(request, "summary"),
    );
    if (!parsed.success)
      throw new HttpError(
        422,
        "invalid_summary",
        "Choose travel fields and their source, or checklist entries. Use only the available summary choices.",
      );
    return json(await previewSummary(memberId, tripId, parsed.data));
  } catch (error) {
    return failure(
      error,
      "Could not refresh this summary. Reconnect and retry; your selection can be kept.",
    );
  }
}
