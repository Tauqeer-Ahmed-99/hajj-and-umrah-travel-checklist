import { acceptedTravelChange } from "./accepted-travel-change";
import {
  itineraryResponse,
  itineraryEntryResponse,
  type ApiError,
  type ItineraryPatch,
  type ItineraryEntryInput,
  type ItineraryEntryPatch,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { TripError } from "./trip-api";

async function request<T>(
  tripId: string,
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse: (value: unknown) => T },
  method = "GET",
  body?: unknown,
): Promise<T> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await fetch(
    `${origin}/api/trips/${tripId}/itinerary${path}`,
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
      error?.error.message ??
        "Could not complete this request. Reconnect and retry.",
      response.status,
      error?.error.fields,
    );
  }
  try {
    const result = schema.parse(await response.json());
    if (method !== "GET") acceptedTravelChange();
    return result;
  } catch {
    throw new TripError(
      "Could not read the response. Check the saved itinerary before retrying.",
    );
  }
}
export const itineraryApi = {
  read: (tripId: string, token: string, signal: AbortSignal) =>
    request(tripId, "", token, signal, itineraryResponse),
  patch: (
    tripId: string,
    body: ItineraryPatch,
    token: string,
    signal: AbortSignal,
  ) => request(tripId, "", token, signal, itineraryResponse, "PATCH", body),
  create: (
    tripId: string,
    body: ItineraryEntryInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      "/entries",
      token,
      signal,
      itineraryEntryResponse,
      "POST",
      body,
    ),
  edit: (
    tripId: string,
    entryId: string,
    body: ItineraryEntryPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      `/entries/${entryId}`,
      token,
      signal,
      itineraryEntryResponse,
      "PATCH",
      body,
    ),
  order: (
    tripId: string,
    entryIds: string[],
    token: string,
    signal: AbortSignal,
  ) =>
    request(tripId, "/order", token, signal, itineraryResponse, "PUT", {
      entryIds,
    }),
  remove: (
    tripId: string,
    entryId: string,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      `/entries/${entryId}`,
      token,
      signal,
      itineraryResponse,
      "DELETE",
    ),
};
