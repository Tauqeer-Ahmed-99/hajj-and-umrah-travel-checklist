import { checklistEntryInput, checklistSaveQuery } from "@nmt/contracts";
import {
  checklistHttp,
  checklistInput,
  type ChecklistContext,
} from "../../../../../../../../src/checklist-http";
import {
  createChecklistEntry,
  readChecklistSave,
} from "../../../../../../../../src/checklist";
import { HttpError } from "../../../../../../../../src/response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: ChecklistContext) {
  return checklistHttp(
    request,
    context,
    async (member, { tripId, familyId }) => {
      const query = checklistSaveQuery.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!query.success)
        throw new HttpError(
          422,
          "invalid_request",
          "Choose the save to check.",
        );
      return readChecklistSave(member, tripId, familyId, query.data.requestId);
    },
  );
}
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
