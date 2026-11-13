import {
  archivesResponse,
  completionResponse,
  completionReviewResponse,
  type CompletionInput,
  type ApiError,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { travelFetch } from "./trip-cache";
import { TripError } from "./trip-api";
import { acceptedTravelChange } from "./accepted-travel-change";

async function request<T>(
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse(value: unknown): T },
  body?: CompletionInput,
): Promise<T> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await travelFetch(`${origin}/api/trips${path}`, {
    signal,
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = await response.json();
    } catch {}
    throw new TripError(
      error?.error?.message ??
        "Could not load completion. Reconnect and retry.",
      response.status,
      error?.error?.fields,
    );
  }
  try {
    const result = schema.parse(await response.json());
    if (body) acceptedTravelChange();
    return result;
  } catch {
    throw new TripError(
      "Could not read the response. Check saved completion before retrying.",
    );
  }
}
export const completionApi = {
  read: (tripId: string, token: string, signal: AbortSignal) =>
    request(`/${tripId}/completion`, token, signal, completionResponse),
  review: (tripId: string, token: string, signal: AbortSignal) =>
    request(
      `/${tripId}/completion/review`,
      token,
      signal,
      completionReviewResponse,
    ),
  save: (
    tripId: string,
    body: CompletionInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(`/${tripId}/completion`, token, signal, completionResponse, body),
  archives: (token: string, signal: AbortSignal) =>
    request("/archives", token, signal, archivesResponse),
};
