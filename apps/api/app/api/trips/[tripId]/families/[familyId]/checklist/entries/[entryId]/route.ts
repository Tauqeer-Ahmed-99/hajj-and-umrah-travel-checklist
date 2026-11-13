import { checklistEntryPatch } from "@nmt/contracts";
import {
  checklistHttp,
  checklistInput,
  type ChecklistContext,
} from "../../../../../../../../../src/checklist-http";
import {
  readChecklistEntry,
  patchChecklistEntry,
  removeChecklistRecord,
} from "../../../../../../../../../src/checklist";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    (member, { tripId, familyId, entryId }) =>
      readChecklistEntry(member, tripId, familyId, entryId!),
  );
}
export function PATCH(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    async (member, { tripId, familyId, entryId }) =>
      patchChecklistEntry(
        member,
        tripId,
        familyId,
        entryId!,
        await checklistInput(request, checklistEntryPatch),
      ),
  );
}
export function DELETE(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    (member, { tripId, familyId, entryId }) =>
      removeChecklistRecord(member, tripId, familyId, entryId!, "entry"),
  );
}
