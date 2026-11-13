import {
  checklistHttp,
  type ChecklistContext,
} from "../../../../../../../../src/checklist-http";
import { readChecklistHistory } from "../../../../../../../../src/checklist";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: ChecklistContext) {
  return checklistHttp(request, context, (member, { tripId, familyId }) =>
    readChecklistHistory(member, tripId, familyId),
  );
}
