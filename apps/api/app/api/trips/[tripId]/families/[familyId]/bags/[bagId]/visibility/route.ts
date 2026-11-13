import { visibilityInput } from "@nmt/contracts";
import { setVisibility } from "../../../../../../../../../src/sharing";
import {
  packingHttp,
  packingInput,
  type PackingContext,
} from "../../../../../../../../../src/packing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: PackingContext) {
  return packingHttp(
    request,
    context,
    async (member, { tripId, familyId, bagId }) =>
      setVisibility(
        member,
        tripId,
        familyId,
        { kind: "bag", id: bagId! },
        await packingInput(request, visibilityInput),
      ),
  );
}
