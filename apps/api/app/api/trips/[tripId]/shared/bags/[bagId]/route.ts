import { sharedBagPatch } from "@nmt/contracts";
import { patchBag } from "../../../../../../../src/packing";
import {
  sharingHttp,
  sharingInput,
  sharedFamily,
  type SharedContext,
} from "../../../../../../../src/sharing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function PATCH(request: Request, context: SharedContext) {
  return sharingHttp(request, context, async (member, { tripId, bagId }) =>
    patchBag(
      member,
      tripId,
      await sharedFamily(member, tripId, "bag", bagId!),
      bagId!,
      await sharingInput(request, sharedBagPatch),
      true,
    ),
  );
}
