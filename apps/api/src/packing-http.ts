import type { z } from "zod";
import { requireMember } from "./permissions";
import { readJson } from "./input";
import { HttpError, failure, json } from "./response";
export type PackingContext = {
  params: Promise<{
    tripId: string;
    familyId: string;
    bagId?: string;
    checkId?: string;
  }>;
};
export async function packingInput<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const result = schema.safeParse(await readJson(request, "packing"));
  if (!result.success)
    throw new HttpError(
      422,
      "invalid_packing",
      "Check the highlighted packing fields.",
      Object.fromEntries(
        result.error.issues.map((issue) => [
          String(issue.path[0] ?? "form"),
          issue.message,
        ]),
      ),
    );
  return result.data;
}
export async function packingHttp(
  request: Request,
  context: PackingContext,
  work: (
    member: string,
    params: Awaited<PackingContext["params"]>,
  ) => Promise<unknown>,
  status = 200,
) {
  try {
    return json(
      await work(await requireMember(request), await context.params),
      status,
    );
  } catch (error) {
    return failure(
      error,
      "Could not confirm this packing request. Refresh bags before starting another change.",
    );
  }
}
