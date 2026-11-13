import { HttpError } from "./response";
export function guideParse<T>(
  schema: {
    safeParse(value: unknown):
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: { path: PropertyKey[]; message: string }[] };
        };
  },
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HttpError(
      422,
      "invalid_guide",
      "Check the highlighted guide fields.",
      Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0] ?? "form"),
          issue.message,
        ]),
      ),
    );
  return parsed.data;
}
