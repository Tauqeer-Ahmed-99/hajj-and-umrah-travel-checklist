import { sharedMove } from "@nmt/contracts";
import { mutatePacking } from "../../../../../../src/packing";
import {
  sharingHttp,
  sharingInput,
  sharedFamily,
  type SharedContext,
} from "../../../../../../src/sharing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request, context: SharedContext) {
  return sharingHttp(request, context, async (member, { tripId, entryId }) => {
    const input = await sharingInput(request, sharedMove);
    return mutatePacking(
      member,
      tripId,
      await sharedFamily(member, tripId, "entry", input.entryId),
      input,
      true,
    );
  });
}
