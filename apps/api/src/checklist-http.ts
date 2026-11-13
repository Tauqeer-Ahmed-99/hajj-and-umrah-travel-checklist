import type { z } from "zod";
import { requireMember } from "./permissions";
import { readJson } from "./input";
import { failure, HttpError, json } from "./response";

export type ChecklistContext = {
  params: Promise<{
    tripId: string;
    familyId: string;
    entryId?: string;
    categoryId?: string;
  }>;
};
export async function checklistInput<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  const parsed = schema.safeParse(await readJson(request, "checklist"));
  if (!parsed.success)
    throw new HttpError(
      422,
      "invalid_checklist",
      "Check the highlighted checklist fields.",
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0] ?? "form"),
          issue.message,
        ]),
      ),
    );
  return parsed.data;
}
export async function checklistHttp(
  request: Request,
  context: ChecklistContext,
  work: (
    memberId: string,
    params: Awaited<ChecklistContext["params"]>,
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
      "Could not confirm this checklist request. Refresh the checklist before starting another change.",
    );
  }
}
