import { departureCheckInput } from "@nmt/contracts";
import {
  packingHttp,
  packingLeg,
  packingInput,
  type PackingContext,
} from "../../../../../../../../src/packing-http";
import { createDepartureCheck } from "../../../../../../../../src/packing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId, checkId }) =>
      createDepartureCheck(
        member,
        tripId,
        familyId,
        await packingInput(request, departureCheckInput),
        packingLeg(request),
      ),
    201,
  );
}
