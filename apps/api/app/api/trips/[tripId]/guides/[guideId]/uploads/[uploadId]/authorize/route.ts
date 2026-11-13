import { fileOperationInput } from "@nmt/contracts";
import { authorizeGuideUpload } from "../../../../../../../../../src/guide-files";
import { requireMember } from "../../../../../../../../../src/permissions";
import { failure, json } from "../../../../../../../../../src/response";
import { readJson } from "../../../../../../../../../src/input";
import { guideParse } from "../../../../../../../../../src/guide-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {
  params: Promise<{ tripId: string; guideId: string; uploadId: string }>;
};
export async function POST(request: Request, context: Context) {
  try {
    const memberId = await requireMember(request);
    const { tripId, guideId, uploadId } = await context.params;
    guideParse(fileOperationInput, await readJson(request, "guide"));
    return json(
      await authorizeGuideUpload(memberId, tripId, guideId, uploadId),
    );
  } catch (error) {
    return failure(
      error,
      "The file request could not be confirmed. Reconnect and retry.",
    );
  }
}
