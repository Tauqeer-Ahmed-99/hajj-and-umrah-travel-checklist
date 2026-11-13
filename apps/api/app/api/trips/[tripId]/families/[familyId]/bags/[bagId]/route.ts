import { bagPatch, packingRemoval } from "@nmt/contracts";
import {
  packingHttp,
  packingInput,
  type PackingContext,
} from "../../../../../../../../src/packing-http";
import { patchBag, removeBag } from "../../../../../../../../src/packing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function PATCH(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId, checkId }) =>
      patchBag(
        member,
        tripId,
        familyId,
        bagId!,
        await packingInput(request, bagPatch),
      ),
    200,
  );
}
export function DELETE(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId, checkId }) =>
      removeBag(
        member,
        tripId,
        familyId,
        bagId!,
        await packingInput(request, packingRemoval),
      ),
    200,
  );
}
