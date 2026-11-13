import { visibilityInput } from "@nmt/contracts";
import { setVisibility } from "../../../../../../../../../../src/sharing";
import {
  checklistHttp,
  checklistInput,
  type ChecklistContext,
} from "../../../../../../../../../../src/checklist-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    async (member, { tripId, familyId, entryId }) =>
      setVisibility(
        member,
        tripId,
        familyId,
        { kind: "entry", id: entryId! },
        await checklistInput(request, visibilityInput),
      ),
  );
}
