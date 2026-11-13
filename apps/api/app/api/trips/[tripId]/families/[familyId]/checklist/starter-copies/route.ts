import { checklistStarterInput } from "@nmt/contracts";
import {
  checklistHttp,
  checklistInput,
  type ChecklistContext,
} from "../../../../../../../../src/checklist-http";
import { copyChecklistStarter } from "../../../../../../../../src/checklist";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    async (member, { tripId, familyId }) =>
      copyChecklistStarter(
        member,
        tripId,
        familyId,
        await checklistInput(request, checklistStarterInput),
      ),
    201,
  );
}
