import {
  familyResponse,
  travelerResponse,
  travelersResponse,
  tripResponse,
  tripsResponse,
  type ApiError,
  type FamilyInput,
  type TravelerInput,
  type TripInput,
  type TripPatch,
  type FamilyPatch,
  type TravelerPatch,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { TripError } from "./request-error";
import { travelFetch } from "./server-data";
export { TripError } from "./request-error";

async function request<T>(
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse: (value: unknown) => T },
  body?: unknown,
  method = body ? "POST" : "GET",
): Promise<T> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to Travel Companion.");
  const response = await travelFetch(`${origin}/api/trips${path}`, {
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
      error?.error?.message ??
        "Could not complete this request. Reconnect and try again.",
      response.status,
      error?.error?.fields,
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new TripError(
      "Could not read the server response. Refresh before starting another save.",
    );
  }
}

export const tripApi = {
  list: (token: string, signal: AbortSignal) =>
    request("", token, signal, tripsResponse),
  read: (id: string, token: string, signal: AbortSignal) =>
    request(`/${id}`, token, signal, tripResponse),
  create: (body: TripInput, token: string, signal: AbortSignal) =>
    request("", token, signal, tripResponse, body),
  edit: (id: string, body: TripPatch, token: string, signal: AbortSignal) =>
    request(`/${id}`, token, signal, tripResponse, body, "PATCH"),
  editFamily: (
    tripId: string,
    familyId: string,
    body: FamilyPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `/${tripId}/families/${familyId}`,
      token,
      signal,
      familyResponse,
      body,
      "PATCH",
    ),
  editTraveler: (
    tripId: string,
    familyId: string,
    travelerId: string,
    body: TravelerPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `/${tripId}/families/${familyId}/travelers/${travelerId}`,
      token,
      signal,
      travelerResponse,
      body,
      "PATCH",
    ),
  addFamily: (
    tripId: string,
    body: FamilyInput,
    token: string,
    signal: AbortSignal,
  ) => request(`/${tripId}/families`, token, signal, familyResponse, body),
  travelers: (
    tripId: string,
    familyId: string,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `/${tripId}/families/${familyId}/travelers`,
      token,
      signal,
      travelersResponse,
    ),
  addTraveler: (
    tripId: string,
    familyId: string,
    body: TravelerInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `/${tripId}/families/${familyId}/travelers`,
      token,
      signal,
      travelerResponse,
      body,
    ),
};
