import { bagStateInput } from "@nmt/contracts";
import {
  packingHttp,
  packingInput,
  type PackingContext,
} from "../../../../../../../../../src/packing-http";
import { setBagState } from "../../../../../../../../../src/packing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId }) =>
      setBagState(
        member,
        tripId,
        familyId,
        bagId!,
        await packingInput(request, bagStateInput),
      ),
    200,
  );
}
