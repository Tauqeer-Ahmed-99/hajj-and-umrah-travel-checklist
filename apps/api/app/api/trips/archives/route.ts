import { requireMember } from "../../../../src/permissions";
import { failure, json } from "../../../../src/response";
import { listArchives } from "../../../../src/completion";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return json(await listArchives(await requireMember(request)));
  } catch (error) {
    return failure(error, "Archives could not be loaded. Reconnect and retry.");
  }
}
