import {
  guideResponse,
  guidesResponse,
  guideHistoryResponse,
  type GuideInput,
  type GuidePatch,
  type GuideQuery,
  type ApiError,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { travelFetch } from "./trip-cache";
import { TripError } from "./trip-api";

export async function guideRequest<T>(
  tripId: string,
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse(value: unknown): T },
  method = "GET",
  body?: unknown,
): Promise<T> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await travelFetch(
    `${origin}/api/trips/${tripId}/guides${path}`,
    {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = await response.json();
    } catch {}
    throw new TripError(
      error?.error?.message ??
        "Could not complete this guide request. Reconnect and retry.",
      response.status,
      error?.error?.fields,
      error?.error?.code,
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new TripError(
      "Could not read the response. Retry the same save or check saved guides.",
    );
  }
}
export const guideApi = {
  list: (
    tripId: string,
    query: GuideQuery,
    token: string,
    signal: AbortSignal,
  ) =>
    guideRequest(
      tripId,
      `?${new URLSearchParams({ q: query.q, ...(query.pinned ? { pinned: query.pinned } : {}) })}`,
      token,
      signal,
      guidesResponse,
    ),
  read: (tripId: string, id: string, token: string, signal: AbortSignal) =>
    guideRequest(tripId, `/${id}`, token, signal, guideResponse),
  history: (tripId: string, id: string, token: string, signal: AbortSignal) =>
    guideRequest(tripId, `/${id}/history`, token, signal, guideHistoryResponse),
  create: (
    tripId: string,
    body: GuideInput,
    token: string,
    signal: AbortSignal,
  ) => guideRequest(tripId, "", token, signal, guideResponse, "POST", body),
  edit: (
    tripId: string,
    id: string,
    body: GuidePatch,
    token: string,
    signal: AbortSignal,
  ) =>
    guideRequest(tripId, `/${id}`, token, signal, guideResponse, "PATCH", body),
};
