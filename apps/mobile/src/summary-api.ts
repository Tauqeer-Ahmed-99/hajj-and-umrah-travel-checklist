import {
  summaryChoices,
  summaryPreview,
  type ApiError,
  type SummarySelection,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { TripError } from "./trip-api";

async function request<T>(
  tripId: string,
  token: string,
  signal: AbortSignal,
  schema: { parse: (value: unknown) => T },
  selection?: SummarySelection,
): Promise<T> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await fetch(`${origin}/api/trips/${tripId}/summary`, {
    method: selection ? "POST" : "GET",
    signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(selection ? { "Content-Type": "application/json" } : {}),
    },
    ...(selection ? { body: JSON.stringify(selection) } : {}),
  });
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = await response.json();
    } catch {}
    throw new TripError(
      error?.error.message ??
        "Could not refresh the summary. Reconnect and retry.",
      response.status,
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new TripError(
      "Could not read this summary. Reconnect and retry. Your selection is kept.",
    );
  }
}

export const summaryApi = {
  choices: (tripId: string, token: string, signal: AbortSignal) =>
    request(tripId, token, signal, summaryChoices),
  preview: (
    tripId: string,
    selection: SummarySelection,
    token: string,
    signal: AbortSignal,
  ) => request(tripId, token, signal, summaryPreview, selection),
};
