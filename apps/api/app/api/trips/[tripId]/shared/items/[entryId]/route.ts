import { sharedEntryPatch } from "@nmt/contracts";
import { patchChecklistEntry } from "../../../../../../../src/checklist";
import {
  sharingHttp,
  sharingInput,
  sharedFamily,
  type SharedContext,
} from "../../../../../../../src/sharing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function PATCH(request: Request, context: SharedContext) {
  return sharingHttp(request, context, async (member, { tripId, entryId }) =>
    patchChecklistEntry(
      member,
      tripId,
      await sharedFamily(member, tripId, "entry", entryId!),
      entryId!,
      await sharingInput(request, sharedEntryPatch),
      true,
    ),
  );
}
