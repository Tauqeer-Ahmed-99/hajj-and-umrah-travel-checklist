import { tripInput } from "@nmt/contracts";
import { requireMember } from "../../../src/permissions";
import { readJson } from "../../../src/input";
import { failure, HttpError, json } from "../../../src/response";
import { createTrip, listTrips } from "../../../src/trips";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return json(await listTrips(await requireMember(request)));
  } catch (error) {
    return failure(
      error,
      "Your trips could not be loaded. Check your connection and try again.",
    );
  }
}

export async function POST(request: Request) {
  try {
    const memberId = await requireMember(request);
    const parsed = tripInput.safeParse(await readJson(request, "trip"));
    if (!parsed.success)
      throw new HttpError(
        422,
        "invalid_trip",
        "Check the highlighted trip fields.",
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "trip"),
            issue.message,
          ]),
        ),
      );
    return json(await createTrip(memberId, parsed.data), 201);
  } catch (error) {
    return failure(
      error,
      "Your trip could not be saved. Check your trips before trying again.",
    );
  }
}
