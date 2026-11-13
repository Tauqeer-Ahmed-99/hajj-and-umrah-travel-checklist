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
} from "@nmt/contracts";
import { apiOrigin } from "./api";

export class TripError extends Error {
  constructor(
    message: string,
    public status = 0,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse: (value: unknown) => T },
  body?: unknown,
): Promise<T> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await fetch(`${origin}/api/trips${path}`, {
    method: body ? "POST" : "GET",
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
