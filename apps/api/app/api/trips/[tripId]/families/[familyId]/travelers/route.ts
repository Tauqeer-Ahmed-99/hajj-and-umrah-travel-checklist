import { travelerInput } from "@nmt/contracts";
import { readJson } from "../../../../../../../src/input";
import { requireMember } from "../../../../../../../src/permissions";
import { failure, HttpError, json } from "../../../../../../../src/response";
import { createTraveler, listTravelers } from "../../../../../../../src/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string; familyId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId, familyId } = await context.params;
    return json(await listTravelers(memberId, tripId, familyId));
  } catch (error) {
    return failure(
      error,
      "The roster could not be loaded. Check your connection and try again.",
    );
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId, familyId } = await context.params;
    const parsed = travelerInput.safeParse(await readJson(request, "traveler"));
    if (!parsed.success)
      throw new HttpError(
        422,
        "invalid_traveler",
        "Check the highlighted traveler fields.",
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "traveler"),
            issue.message,
          ]),
        ),
      );
    return json(
      await createTraveler(memberId, tripId, familyId, parsed.data),
      201,
    );
  } catch (error) {
    return failure(
      error,
      "The traveler could not be saved. Refresh the roster before trying again.",
    );
  }
}
