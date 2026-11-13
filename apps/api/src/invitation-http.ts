import { HttpError, failure, json } from "./response";
import { readJson } from "./input";

export async function invitationHttp(
  work: () => Promise<unknown>,
  status = 200,
) {
  try {
    return json(await work(), status);
  } catch (error) {
    return failure(
      error,
      "Access could not be checked or saved. Reconnect and refresh before trying again.",
    );
  }
}
export async function invitationBody<T>(
  request: Request,
  schema: {
    safeParse: (input: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: { path: PropertyKey[]; message: string }[] };
        };
  },
) {
  const parsed = schema.safeParse(await readJson(request, "invitation"));
  if (!parsed.success)
    throw new HttpError(
      422,
      "invalid_invitation",
      "Check the invitation fields.",
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0] ?? "invitation"),
          issue.message,
        ]),
      ),
    );
  return parsed.data;
}
