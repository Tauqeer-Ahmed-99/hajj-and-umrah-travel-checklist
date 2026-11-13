import { bagStateInput } from "@nmt/contracts";
import { setBagState } from "../../../../../../../../src/packing";
import {
  sharingHttp,
  sharingInput,
  sharedFamily,
  type SharedContext,
} from "../../../../../../../../src/sharing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: SharedContext) {
  return sharingHttp(request, context, async (member, { tripId, bagId }) =>
    setBagState(
      member,
      tripId,
      await sharedFamily(member, tripId, "bag", bagId!),
      bagId!,
      await sharingInput(request, bagStateInput),
      true,
    ),
  );
}
