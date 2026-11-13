import { packingLeg } from "../../../../../src/packing-http";
import { readShared } from "../../../../../src/sharing";
import {
  sharingHttp,
  type SharedContext,
} from "../../../../../src/sharing-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: SharedContext) {
  return sharingHttp(request, context, (member, { tripId }) =>
    readShared(member, tripId, packingLeg(request)),
  );
}
