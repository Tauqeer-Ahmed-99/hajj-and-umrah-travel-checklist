import { acceptedTravelChange } from "./accepted-travel-change";
import {
  checklistResponse,
  acquisitionViewsResponse,
  checklistEntryResponse,
  checklistSaveResponse,
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
  type ChecklistBulkRemovalInput,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { serverAccountFence, travelFetch } from "./server-data";
import { TripError } from "./trip-api";
import {
  RequestDeadlineError,
  waitForRequest,
  withinRequest,
} from "./request-deadline";

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
    throw new TripError("This build could not connect to Travel Companion.");
  const response = await travelFetch(
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
async function saveEntry(
  scope: ChecklistScope,
  path: string,
  token: string,
  signal: AbortSignal,
  method: "POST" | "PATCH",
  body: { requestId?: string },
  operation: "create" | "edit" | "acquisition",
  entryId?: string,
) {
  const assertAccount = serverAccountFence();
  try {
    // Leave room inside useTripRequest's overall deadline to confirm a save
    // whose connection stalls. Aborting that whole request would skip recovery.
    const saved = await withinRequest(signal, 12_000, (writeSignal) =>
      request(
        scope,
        path,
        token,
        writeSignal,
        checklistEntryResponse,
        method,
        body,
      ),
    );
    assertAccount();
    return saved;
  } catch (error) {
    assertAccount();
    if (
      signal.aborted ||
      !body.requestId ||
      (error instanceof TripError && error.code === "request_cancelled") ||
      (error instanceof TripError && error.status > 0 && error.status < 500)
    )
      throw error;
    // Only read the result of this exact save. Never automatically POST again,
    // match by title, or trust a stale cached "not saved" result.
    try {
      const saved = await withinRequest(signal, 10_000, async (checkSignal) => {
        const path = `/entries?${new URLSearchParams({ requestId: body.requestId!, operation, ...(entryId ? { entryId } : {}) })}`;
        let result: ReturnType<typeof checklistSaveResponse.parse> | undefined;
        let lastFailure: unknown;
        // Receipt reads bypass the query cache. Bound each individual connection
        // too, so one stalled confirmation cannot consume the whole recovery window.
        for (const pause of [0, 750, 1_500, 2_500, 3_500]) {
          if (pause) await waitForRequest(checkSignal, pause);
          assertAccount();
          try {
            result = await withinRequest(checkSignal, 3_000, (attemptSignal) =>
              request(scope, path, token, attemptSignal, checklistSaveResponse),
            );
            assertAccount();
            if (result.entry || !(error instanceof RequestDeadlineError))
              return result;
          } catch (checkError) {
            assertAccount();
            if (
              checkSignal.aborted ||
              (checkError instanceof TripError &&
                (checkError.code === "request_cancelled" ||
                  (checkError.status > 0 && checkError.status < 500)))
            )
              throw checkError;
            lastFailure = checkError;
          }
        }
        if (result) return result;
        throw lastFailure;
      });
      if (saved.entry) {
        acceptedTravelChange();
        return { entry: saved.entry };
      }
    } catch (checkError) {
      assertAccount();
      if (
        checkError instanceof TripError &&
        [401, 403, 404].includes(checkError.status)
      )
        throw checkError;
    }
    throw error instanceof RequestDeadlineError
      ? new TripError(
          "The save could not be confirmed yet. Your details are still here. Try again.",
        )
      : error;
  }
}
export const checklistApi = {
  removeSelection: (
    scope: ChecklistScope,
    body: ChecklistBulkRemovalInput,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      scope,
      "/bulk-removal",
      token,
      signal,
      checklistSavedResponse,
      "POST",
      body,
    ),
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
    saveEntry(
      scope,
      `/entries/${id}/acquisition`,
      token,
      signal,
      "POST",
      body,
      "acquisition",
      id,
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
  ) => saveEntry(scope, "/entries", token, signal, "POST", body, "create"),
  edit: (
    scope: ChecklistScope,
    id: string,
    body: ChecklistEntryPatch,
    token: string,
    signal: AbortSignal,
  ) =>
    saveEntry(
      scope,
      `/entries/${id}`,
      token,
      signal,
      "PATCH",
      body,
      "edit",
      id,
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
