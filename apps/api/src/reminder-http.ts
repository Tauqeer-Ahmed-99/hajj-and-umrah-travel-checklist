import { requireMember } from "./permissions";
import { readJson } from "./input";
import { failure, HttpError, json } from "./response";
import type { z } from "zod";
export type ReminderContext = {
  params: Promise<{ tripId: string; reminderId?: string }>;
};
export async function reminderBody<T>(request: Request, schema: z.ZodType<T>) {
  const parsed = schema.safeParse(await readJson(request, "reminder"));
  if (!parsed.success)
    throw new HttpError(
      422,
      "invalid_reminder",
      "Check the reminder fields.",
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0] ?? "form"),
          issue.message,
        ]),
      ),
    );
  return parsed.data;
}
export async function reminderHttp(
  request: Request,
  context: ReminderContext,
  work: (
    actor: string,
    params: Awaited<ReminderContext["params"]>,
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
      "Could not confirm this reminder request. Refresh before starting another change.",
    );
  }
}
