import {
  sharedContentResponse,
  checklistSavedResponse,
  type ApiError,
  type VisibilityInput,
  type SharedEntryPatch,
  type SharedBagPatch,
  type BagStateInput,
  type AcquisitionInput,
  type PackingMove,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { TripError } from "./trip-api";
import { acceptedTravelChange } from "./accepted-travel-change";
async function request<T>(
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse: (value: unknown) => T },
  method = "GET",
  body?: unknown,
) {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await fetch(`${origin}/api/trips/${path}`, {
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
        "Could not confirm this shared change. Refresh before starting another change.",
      response.status,
      error?.error.fields,
    );
  }
  let result: T;
  try {
    result = schema.parse(await response.json());
  } catch {
    throw new TripError(
      "Could not read the response. Check shared content before retrying.",
    );
  }
  if (method !== "GET") acceptedTravelChange();
  return result;
}
export const sharingApi = {
  read: (tripId: string, token: string, signal: AbortSignal) =>
    request(`${tripId}/shared`, token, signal, sharedContentResponse),
  visibility: (
    tripId: string,
    familyId: string,
    kind: "entry" | "bag",
    id: string,
    input: VisibilityInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `${tripId}/families/${familyId}/${kind === "entry" ? "checklist/entries" : "bags"}/${id}/visibility`,
      token,
      signal,
      checklistSavedResponse,
      "POST",
      input,
    ),
  editItem: (
    tripId: string,
    id: string,
    input: SharedEntryPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `${tripId}/shared/items/${id}`,
      token,
      signal,
      checklistSavedResponse,
      "PATCH",
      input,
    ),
  acquire: (
    tripId: string,
    id: string,
    input: AcquisitionInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `${tripId}/shared/items/${id}/acquisition`,
      token,
      signal,
      checklistSavedResponse,
      "POST",
      input,
    ),
  editBag: (
    tripId: string,
    id: string,
    input: SharedBagPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `${tripId}/shared/bags/${id}`,
      token,
      signal,
      checklistSavedResponse,
      "PATCH",
      input,
    ),
  bagState: (
    tripId: string,
    id: string,
    input: BagStateInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `${tripId}/shared/bags/${id}/state`,
      token,
      signal,
      checklistSavedResponse,
      "POST",
      input,
    ),
  move: (
    tripId: string,
    input: PackingMove,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      `${tripId}/shared/packing`,
      token,
      signal,
      checklistSavedResponse,
      "POST",
      input,
    ),
};
