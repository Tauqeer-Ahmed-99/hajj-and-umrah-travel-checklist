import { checklistEntryInput } from "@nmt/contracts";
import {
  checklistHttp,
  checklistInput,
  type ChecklistContext,
} from "../../../../../../../../src/checklist-http";
import { createChecklistEntry } from "../../../../../../../../src/checklist";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    async (member, { tripId, familyId }) =>
      createChecklistEntry(
        member,
        tripId,
        familyId,
        await checklistInput(request, checklistEntryInput),
      ),
    201,
  );
}
