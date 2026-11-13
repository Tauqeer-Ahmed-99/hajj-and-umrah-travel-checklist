import { bagInput } from "@nmt/contracts";
import {
  packingHttp,
  packingInput,
  type PackingContext,
} from "../../../../../../../src/packing-http";
import { createBag } from "../../../../../../../src/packing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId }) =>
      createBag(
        member,
        tripId,
        familyId,
        await packingInput(request, bagInput),
      ),
    201,
  );
}
