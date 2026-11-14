import {
  overviewResponse,
  overviewActivityResponse,
  type ApiError,
  type OverviewQuery,
} from "@nmt/contracts";
import { apiOrigin } from "./api";
import { travelFetch } from "./trip-cache";
import { TripError } from "./trip-api";

async function read<T>(
  tripId: string,
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await travelFetch(
    `${origin}/api/trips/${tripId}/overview${path}`,
    { signal, headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    let error: ApiError | undefined;
    try {
      error = await response.json();
    } catch {}
    throw new TripError(
      error?.error?.message ??
        "Could not refresh this view. Reconnect and retry.",
      response.status,
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new TripError(
      "Could not read this view. Refresh before relying on it.",
    );
  }
}
export const overviewApi = {
  read(
    tripId: string,
    query: OverviewQuery,
    token: string,
    signal: AbortSignal,
  ) {
    const params = new URLSearchParams();
    if (query.scope !== "all") params.set("scope", query.scope);
    if (query.q) params.set("q", query.q);
    if (query.attention) params.set("attention", query.attention);
    if (query.familyId) params.set("familyId", query.familyId);
    return read(
      tripId,
      `${query.leg === "return" ? "/return" : ""}${params.size ? `?${params}` : ""}`,
      token,
      signal,
      overviewResponse,
    );
  },
  activity(
    tripId: string,
    entryId: string,
    leg: "outbound" | "return",
    token: string,
    signal: AbortSignal,
  ) {
    return read(
      tripId,
      `/activity?${new URLSearchParams({ entryId, leg })}`,
      token,
      signal,
      overviewActivityResponse,
    );
  },
};
