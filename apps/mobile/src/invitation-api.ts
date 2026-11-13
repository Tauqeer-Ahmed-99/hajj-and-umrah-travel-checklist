import { acceptedTravelChange } from "./accepted-travel-change";
import {
  acceptedInvitationResponse,
  accessSavedResponse,
  invitationResponse,
  invitationsResponse,
  membersResponse,
  type ApiError,
  type InvitationInput,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { travelFetch } from "./trip-cache";
import { TripError } from "./trip-api";

export type AccessChange = {
  path: string;
  method: "POST" | "PUT" | "DELETE";
  body?: unknown;
};
async function request<T>(
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
  const response = await travelFetch(`${origin}/api${path}`, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = await response.json();
    } catch {}
    throw new TripError(
      error?.error?.message ??
        "Could not check access. Reconnect and refresh before trying again.",
      response.status,
      error?.error?.fields,
    );
  }
  try {
    const result = schema.parse(await response.json());
    if (method !== "GET") acceptedTravelChange();
    return result;
  } catch {
    throw new TripError(
      "Could not read the response. Refresh to check the saved access.",
    );
  }
}
export const invitationApi = {
  inbox: (token: string, signal: AbortSignal) =>
    request("/invitations", token, signal, invitationsResponse),
  preview: (id: string, token: string, signal: AbortSignal) =>
    request(
      `/invitations/${encodeURIComponent(id)}`,
      token,
      signal,
      invitationResponse,
    ),
  accept: (id: string, token: string, signal: AbortSignal) =>
    request(
      `/invitations/${id}/accept`,
      token,
      signal,
      acceptedInvitationResponse,
      "POST",
      {},
    ),
  managed: (tripId: string, token: string, signal: AbortSignal) =>
    request(`/trips/${tripId}/invitations`, token, signal, invitationsResponse),
  create: (
    tripId: string,
    input: InvitationInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `/trips/${tripId}/invitations`,
      token,
      signal,
      invitationResponse,
      "POST",
      input,
    ),
  members: (
    tripId: string,
    familyId: string | undefined,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `/trips/${tripId}${familyId ? `/families/${familyId}` : ""}/members`,
      token,
      signal,
      membersResponse,
    ),
  change: (change: AccessChange, token: string, signal: AbortSignal) =>
    request(
      change.path,
      token,
      signal,
      accessSavedResponse,
      change.method,
      change.body,
    ),
  invitationChange: (
    change: AccessChange,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      change.path,
      token,
      signal,
      invitationResponse,
      change.method,
      change.body,
    ),
};
