import { checklistCategoryPatch } from "@nmt/contracts";
import {
  checklistHttp,
  checklistInput,
  type ChecklistContext,
} from "../../../../../../../../../src/checklist-http";
import {
  patchChecklistCategory,
  removeChecklistRecord,
} from "../../../../../../../../../src/checklist";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function PATCH(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    async (member, { tripId, familyId, categoryId }) =>
      patchChecklistCategory(
        member,
        tripId,
        familyId,
        categoryId!,
        await checklistInput(request, checklistCategoryPatch),
      ),
  );
}
export function DELETE(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    (member, { tripId, familyId, categoryId }) =>
      removeChecklistRecord(member, tripId, familyId, categoryId!, "category"),
  );
}
