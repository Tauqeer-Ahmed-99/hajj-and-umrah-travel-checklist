import { acquisitionInput } from "@nmt/contracts";
import { mutateAcquisition } from "../../../../../../../../src/checklist";
import {
  sharingHttp,
  sharingInput,
  sharedFamily,
  type SharedContext,
} from "../../../../../../../../src/sharing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: SharedContext) {
  return sharingHttp(request, context, async (member, { tripId, entryId }) => {
    const input = await sharingInput(request, acquisitionInput);
    return mutateAcquisition(
      member,
      tripId,
      await sharedFamily(member, tripId, "entry", entryId!),
      entryId!,
      input,
      true,
    );
  });
}
