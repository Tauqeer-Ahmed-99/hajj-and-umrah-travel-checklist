import {
  checklistHttp,
  type ChecklistContext,
} from "../../../../../../../../src/checklist-http";
import { readAcquisitionViews } from "../../../../../../../../src/checklist";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: ChecklistContext) {
  return checklistHttp(request, context, (member, { tripId, familyId }) =>
    readAcquisitionViews(member, tripId, familyId),
  );
}
