import {
  packingResponse,
  returnPreparationResponse,
  type ReturnPreparationInput,
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
import { acceptedTravelChange } from "./accepted-travel-change";
import { TripError } from "./trip-api";
import type { ChecklistScope } from "./checklist-api";

type PackingScope = ChecklistScope & { leg?: "outbound" | "return" };
async function request<T>(
  scope: PackingScope,
  path: string,
  schema: { parse: (value: unknown) => T },
  token: string,
  signal: AbortSignal,
  method = "GET",
  body?: unknown,
) {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await fetch(
    `${origin}/api/trips/${scope.tripId}/families/${scope.familyId}${path}${scope.leg ? `?leg=${scope.leg}` : ""}`,
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
    const result = schema.parse(await response.json());
    if (method !== "GET") acceptedTravelChange();
    return result;
  } catch {
    throw new TripError(
      "Could not read the response. Check saved bags before retrying.",
    );
  }
}
export const packingApi = {
  returnRead: (scope: PackingScope, token: string, signal: AbortSignal) =>
    request(
      scope,
      "/return-preparation",
      returnPreparationResponse,
      token,
      signal,
    ),
  returnSave: (
    scope: PackingScope,
    body: ReturnPreparationInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      "/return-preparation",
      returnPreparationResponse,
      token,
      signal,
      "POST",
      body,
    ),
  read: (scope: PackingScope, token: string, signal: AbortSignal) =>
    request(scope, "/packing", packingResponse, token, signal),
  bag: (
    scope: PackingScope,
    id: string | null,
    body: BagInput | BagPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      `/bags${id ? `/${id}` : ""}`,
      packingResponse,
      token,
      signal,
      id ? "PATCH" : "POST",
      body,
    ),
  state: (
    scope: PackingScope,
    id: string,
    body: BagStateInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      `/bags/${id}/state`,
      packingResponse,
      token,
      signal,
      "POST",
      body,
    ),
  move: (
    scope: PackingScope,
    body: PackingInput,
    token: string,
    signal: AbortSignal,
  ) => request(scope, "/packing", packingResponse, token, signal, "POST", body),
  check: (
    scope: PackingScope,
    id: string | null,
    body: DepartureCheckInput | DepartureCheckPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      `/packing/departure-checks${id ? `/${id}` : ""}`,
      packingResponse,
      token,
      signal,
      id ? "PATCH" : "POST",
      body,
    ),
  remove: (
    scope: PackingScope,
    kind: "bag" | "check",
    id: string,
    body: PackingRemoval,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      kind === "bag" ? `/bags/${id}` : `/packing/departure-checks/${id}`,
      packingResponse,
      token,
      signal,
      "DELETE",
      body,
    ),
};
