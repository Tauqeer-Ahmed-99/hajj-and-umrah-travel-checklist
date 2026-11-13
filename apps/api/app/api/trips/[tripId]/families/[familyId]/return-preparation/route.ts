import { returnPreparationInput } from "@nmt/contracts";
import {
  packingHttp,
  packingInput,
  type PackingContext,
} from "../../../../../../../src/packing-http";
import {
  readReturnPreparation,
  mutateReturnPreparation,
} from "../../../../../../../src/return-preparation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request, context: PackingContext) {
  return packingHttp(request, context, (member, { tripId, familyId }) =>
    readReturnPreparation(member, tripId, familyId),
  );
}
export function POST(request: Request, context: PackingContext) {
  return packingHttp(request, context, async (member, { tripId, familyId }) =>
    mutateReturnPreparation(
      member,
      tripId,
      familyId,
      await packingInput(request, returnPreparationInput),
    ),
  );
}
