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
import { travelFetch } from "./server-data";
import { TripError } from "./trip-api";

export async function itineraryRequest<T>(
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
    throw new TripError("This build could not connect to Travel Companion.");
  const response = await travelFetch(`${origin}/api/trips/${tripId}${path}`, {
    method,
    signal,
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
    itineraryRequest(tripId, "/itinerary", token, signal, itineraryResponse),
  patch: (
    tripId: string,
    body: ItineraryPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    itineraryRequest(
      tripId,
      "/itinerary",
      token,
      signal,
      itineraryResponse,
      "PATCH",
      body,
    ),
  create: (
    tripId: string,
    body: ItineraryEntryInput,
    token: string,
    signal: AbortSignal,
  ) =>
    itineraryRequest(
      tripId,
      "/itinerary/entries",
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
    itineraryRequest(
      tripId,
      `/itinerary/entries/${entryId}`,
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
    itineraryRequest(
      tripId,
      "/itinerary/order",
      token,
      signal,
      itineraryResponse,
      "PUT",
      {
        entryIds,
      },
    ),
  remove: (
    tripId: string,
    entryId: string,
    token: string,
    signal: AbortSignal,
  ) =>
    itineraryRequest(
      tripId,
      `/itinerary/entries/${entryId}`,
      token,
      signal,
      itineraryResponse,
      "DELETE",
    ),
};
