import { accountRemovalInput } from "@nmt/contracts";
import {
  readAccountRemoval,
  removeAccount,
} from "../../../../src/account-removal";
import { invitationBody } from "../../../../src/invitation-http";
import { failure, json } from "../../../../src/response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return json(await readAccountRemoval(request));
  } catch (error) {
    return failure(
      error,
      "Removal status could not be confirmed. Reconnect and check again.",
    );
  }
}
export async function POST(request: Request) {
  try {
    const result = await removeAccount(
      request,
      await invitationBody(request, accountRemovalInput),
    );
    return json(result, result.state === "provider_pending" ? 202 : 200);
  } catch (error) {
    return failure(
      error,
      "Account removal could not be confirmed. Check removal status before explicitly retrying.",
    );
  }
}
