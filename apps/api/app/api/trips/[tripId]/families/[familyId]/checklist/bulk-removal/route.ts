import { checklistBulkRemovalInput } from "@nmt/contracts";
import {
  checklistHttp,
  checklistInput,
  type ChecklistContext,
} from "../../../../../../../../src/checklist-http";
import { removeChecklistSelection } from "../../../../../../../../src/bulk-checklist";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: ChecklistContext) {
  return checklistHttp(request, context, async (member, { tripId, familyId }) =>
    removeChecklistSelection(
      member,
      tripId,
      familyId,
      await checklistInput(request, checklistBulkRemovalInput, 64 * 1024),
    ),
  );
}
