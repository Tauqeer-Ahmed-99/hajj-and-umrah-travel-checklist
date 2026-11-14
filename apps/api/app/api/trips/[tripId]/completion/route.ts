import { completionInput } from "@nmt/contracts";
import { requireMember } from "../../../../../src/permissions";
import { readJson } from "../../../../../src/input";
import { failure, HttpError, json } from "../../../../../src/response";
import {
  readCompletion,
  mutateCompletion,
} from "../../../../../src/completion";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    return json(await readCompletion(memberId, tripId));
  } catch (error) {
    return failure(
      error,
      "Completion could not be loaded. Reconnect and retry.",
    );
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId } = await context.params;
    const parsed = completionInput.safeParse(
      await readJson(request, "completion"),
    );
    if (!parsed.success)
      throw new HttpError(
        422,
        "invalid_completion",
        "Review and confirm the completion details.",
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "form"),
            issue.message,
          ]),
        ),
      );
    return json(await mutateCompletion(memberId, tripId, parsed.data));
  } catch (error) {
    return failure(
      error,
      "This save could not be confirmed. Check the saved completion before retrying.",
    );
  }
}
