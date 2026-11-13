import { acceptedTravelChange } from "./accepted-travel-change";
import {
  checklistResponse,
  acquisitionViewsResponse,
  checklistEntryResponse,
  checklistCategoryResponse,
  checklistHistoryResponse,
  checklistSavedResponse,
  checklistStarterResponse,
  type ApiError,
  type ChecklistCategoryInput,
  type ChecklistEntryInput,
  type ChecklistEntryPatch,
  type ChecklistStarterInput,
  type AcquisitionInput,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { TripError } from "./trip-api";

export type ChecklistScope = { tripId: string; familyId: string };
async function request<T>(
  scope: ChecklistScope,
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
  const response = await fetch(
    `${origin}/api/trips/${scope.tripId}/families/${scope.familyId}/checklist${path}`,
    {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = await response.json();
    } catch {}
    throw new TripError(
      error?.error.message ??
        "Could not confirm this request. Refresh the checklist before starting another change.",
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
      "Could not read the response. Check the saved checklist before retrying.",
    );
  }
}
export const checklistApi = {
  acquisitionViews: (
    scope: ChecklistScope,
    token: string,
    signal: AbortSignal,
  ) => request(scope, "/acquisition", token, signal, acquisitionViewsResponse),
  acquire: (
    scope: ChecklistScope,
    id: string,
    body: AcquisitionInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      `/entries/${id}/acquisition`,
      token,
      signal,
      checklistEntryResponse,
      "POST",
      body,
    ),
  read: (scope: ChecklistScope, token: string, signal: AbortSignal) =>
    request(scope, "", token, signal, checklistResponse),
  history: (scope: ChecklistScope, token: string, signal: AbortSignal) =>
    request(scope, "/history", token, signal, checklistHistoryResponse),
  category: (
    scope: ChecklistScope,
    id: string | null,
    body: ChecklistCategoryInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      `/categories${id ? `/${id}` : ""}`,
      token,
      signal,
      checklistCategoryResponse,
      id ? "PATCH" : "POST",
      body,
    ),
  create: (
    scope: ChecklistScope,
    body: ChecklistEntryInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      "/entries",
      token,
      signal,
      checklistEntryResponse,
      "POST",
      body,
    ),
  edit: (
    scope: ChecklistScope,
    id: string,
    body: ChecklistEntryPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      `/entries/${id}`,
      token,
      signal,
      checklistEntryResponse,
      "PATCH",
      body,
    ),
  remove: (
    scope: ChecklistScope,
    kind: "categories" | "entries",
    id: string,
    token: string,
    signal: AbortSignal,
    details?: { reason?: string; requestId?: string },
  ) =>
    request(
      scope,
      `/${kind}/${id}`,
      token,
      signal,
      checklistSavedResponse,
      "DELETE",
      kind === "entries" ? details : undefined,
    ),
  copy: (
    scope: ChecklistScope,
    body: ChecklistStarterInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      "/starter-copies",
      token,
      signal,
      checklistStarterResponse,
      "POST",
      body,
    ),
};
