import type { z } from "zod";
import { requireMember, requireTripAccess, resourceId } from "./permissions";
import { transaction } from "./trips";
import { readJson } from "./input";
import { HttpError, failure, json } from "./response";
export type SharedContext = {
  params: Promise<{ tripId: string; entryId?: string; bagId?: string }>;
};
export async function sharingInput<T>(request: Request, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await readJson(request, "sharing"));
  if (!parsed.success)
    throw new HttpError(
      422,
      "invalid_sharing",
      "Check the sharing fields.",
      Object.fromEntries(
        parsed.error.issues.map((i) => [
          String(i.path[0] ?? "form"),
          i.message,
        ]),
      ),
    );
  return parsed.data;
}
export async function sharingHttp(
  request: Request,
  context: SharedContext,
  work: (
    member: string,
    params: Awaited<SharedContext["params"]>,
  ) => Promise<unknown>,
) {
  try {
    return json(await work(await requireMember(request), await context.params));
  } catch (error) {
    return failure(
      error,
      "Could not confirm this shared change. Refresh before starting another change.",
    );
  }
}
export function sharedFamily(
  member: string,
  tripId: string,
  kind: "entry" | "bag",
  id: string,
) {
  return transaction(async (db) => {
    await requireTripAccess(db, member, tripId);
    resourceId(id);
    const table = kind === "entry" ? "checklist_entries" : "bags";
    const result = await db.query<{ familyId: string }>(
      `SELECT c.family_id AS "familyId" FROM ${table} c JOIN families f ON f.id = c.family_id WHERE f.trip_id = $1 AND c.id = $2 AND c.audience = 'trip' AND c.removed_at IS NULL`,
      [tripId, id],
    );
    if (!result.rows[0])
      throw new HttpError(
        404,
        "not_found",
        "This shared record is not available to you.",
      );
    return result.rows[0].familyId;
  });
}
