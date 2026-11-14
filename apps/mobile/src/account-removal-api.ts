import {
  accountRemovalResponse,
  type ApiError,
  type AccountRemoval,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { travelFetch } from "./trip-cache";
import { TripError } from "./trip-api";

export async function accountRemovalRequest(
  authorization: string,
  signal: AbortSignal,
  requestId?: string,
): Promise<AccountRemoval> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await travelFetch(`${origin}/api/me/removal`, {
    method: requestId ? "POST" : "GET",
    signal,
    headers: {
      Authorization: authorization,
      ...(requestId ? { "Content-Type": "application/json" } : {}),
    },
    ...(requestId
      ? {
          body: JSON.stringify({
            confirmation: "Remove my account",
            requestId,
          }),
        }
      : {}),
  });
  if (!response.ok) {
    const result: ApiError | null = await response.json().catch(() => null);
    throw new TripError(
      result?.error?.message ??
        "Removal could not be confirmed. Check its saved status before retrying.",
      response.status,
    );
  }
  return accountRemovalResponse.parse(await response.json());
}
