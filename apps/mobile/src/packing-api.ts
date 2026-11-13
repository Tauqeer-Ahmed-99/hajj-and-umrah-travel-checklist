import {
  packingResponse,
  type ApiError,
  type BagInput,
  type BagPatch,
  type BagStateInput,
  type PackingInput,
  type PackingRemoval,
  type DepartureCheckInput,
  type DepartureCheckPatch,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { TripError } from "./trip-api";
import type { ChecklistScope } from "./checklist-api";

async function request(
  scope: ChecklistScope,
  path: string,
  token: string,
  signal: AbortSignal,
  method = "GET",
  body?: unknown,
) {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await fetch(
    `${origin}/api/trips/${scope.tripId}/families/${scope.familyId}${path}`,
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
        "Could not confirm this request. Refresh bags before starting another change.",
      response.status,
      error?.error.fields,
    );
  }
  try {
    return packingResponse.parse(await response.json());
  } catch {
    throw new TripError(
      "Could not read the response. Check saved bags before retrying.",
    );
  }
}
export const packingApi = {
  read: (scope: ChecklistScope, token: string, signal: AbortSignal) =>
    request(scope, "/packing", token, signal),
  bag: (
    scope: ChecklistScope,
    id: string | null,
    body: BagInput | BagPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      `/bags${id ? `/${id}` : ""}`,
      token,
      signal,
      id ? "PATCH" : "POST",
      body,
    ),
  state: (
    scope: ChecklistScope,
    id: string,
    body: BagStateInput,
    token: string,
    signal: AbortSignal,
  ) => request(scope, `/bags/${id}/state`, token, signal, "POST", body),
  move: (
    scope: ChecklistScope,
    body: PackingInput,
    token: string,
    signal: AbortSignal,
  ) => request(scope, "/packing", token, signal, "POST", body),
  check: (
    scope: ChecklistScope,
    id: string | null,
    body: DepartureCheckInput | DepartureCheckPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      `/packing/departure-checks${id ? `/${id}` : ""}`,
      token,
      signal,
      id ? "PATCH" : "POST",
      body,
    ),
  remove: (
    scope: ChecklistScope,
    kind: "bag" | "check",
    id: string,
    body: PackingRemoval,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      kind === "bag" ? `/bags/${id}` : `/packing/departure-checks/${id}`,
      token,
      signal,
      "DELETE",
      body,
    ),
};
