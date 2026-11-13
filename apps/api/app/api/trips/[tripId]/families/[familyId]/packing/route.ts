import { packingInput as commandSchema } from "@nmt/contracts";
import {
  packingHttp,
  packingInput,
  type PackingContext,
} from "../../../../../../../src/packing-http";
import { readPacking, mutatePacking } from "../../../../../../../src/packing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId }) =>
      readPacking(member, tripId, familyId),
    200,
  );
}
export function POST(request: Request, context: PackingContext) {
  return packingHttp(request, context, async (member, { tripId, familyId }) =>
    mutatePacking(
      member,
      tripId,
      familyId,
      await packingInput(request, commandSchema),
    ),
  );
}
