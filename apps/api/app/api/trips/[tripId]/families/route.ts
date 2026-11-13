import { familyInput } from "@nmt/contracts";
import { readJson } from "../../../../../src/input";
import { requireMember } from "../../../../../src/permissions";
import { failure, HttpError, json } from "../../../../../src/response";
import { createFamily } from "../../../../../src/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    const parsed = familyInput.safeParse(await readJson(request, "family"));
    if (!parsed.success)
      throw new HttpError(
        422,
        "invalid_family",
        "Check the highlighted family fields.",
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "family"),
            issue.message,
          ]),
        ),
      );
    return json(await createFamily(memberId, tripId, parsed.data), 201);
  } catch (error) {
    return failure(
      error,
      "Your family could not be saved. Refresh the trip before trying again.",
    );
  }
}
