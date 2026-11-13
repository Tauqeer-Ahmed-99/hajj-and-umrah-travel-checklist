import { timingSafeEqual } from "node:crypto";
import { dispatchNotifications } from "../../../../src/notification-dispatch";
import { failure, HttpError, json } from "../../../../src/response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret)
      throw new HttpError(
        503,
        "dispatch_disabled",
        "Notification reconciliation is not configured.",
      );
    const provided = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    )
      throw new HttpError(
        401,
        "dispatch_forbidden",
        "Dispatch authorization required.",
      );
    return json(await dispatchNotifications());
  } catch (error) {
    return failure(error);
  }
}
export const POST = GET;
