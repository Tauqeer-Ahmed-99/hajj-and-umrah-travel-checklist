import { acquisitionInput } from "@nmt/contracts";
import {
  checklistHttp,
  checklistInput,
  type ChecklistContext,
} from "../../../../../../../../../../src/checklist-http";
import { mutateAcquisition } from "../../../../../../../../../../src/checklist";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    async (member, { tripId, familyId, entryId }) =>
      mutateAcquisition(
        member,
        tripId,
        familyId,
        entryId!,
        await checklistInput(request, acquisitionInput),
      ),
  );
}
