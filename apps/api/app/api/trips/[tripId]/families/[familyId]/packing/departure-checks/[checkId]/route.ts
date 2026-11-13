import { departureCheckPatch, packingRemoval } from "@nmt/contracts";
import {
  packingHttp,
  packingLeg,
  packingInput,
  type PackingContext,
} from "../../../../../../../../../src/packing-http";
import { patchDepartureCheck } from "../../../../../../../../../src/packing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function PATCH(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId, checkId }) =>
      patchDepartureCheck(
        member,
        tripId,
        familyId,
        checkId!,
        await packingInput(request, departureCheckPatch),
        false,
        packingLeg(request),
      ),
    200,
  );
}
export function DELETE(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId, checkId }) =>
      patchDepartureCheck(
        member,
        tripId,
        familyId,
        checkId!,
        await packingInput(request, packingRemoval),
        true,
        packingLeg(request),
      ),
    200,
  );
}
