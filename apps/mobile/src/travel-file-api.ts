import {
  fileAuthorization,
  guideFile,
  openFileResponse,
  travelFileResponse,
  travelFilesResponse,
  travelUploadResponse,
  uploadsResponse,
  type TravelFileInput,
  type UploadDetails,
} from "@nmt/contracts";
import { z } from "zod";
import { apiOrigin } from "./api";
import { travelFetch } from "./trip-cache";
import { TripError } from "./trip-api";
import { acceptedTravelChange } from "./accepted-travel-change";

async function request<T>(
  tripId: string,
  path: string,
  token: string,
  signal: AbortSignal,
  schema: { parse(value: unknown): T },
  body?: unknown,
) {
  const origin = apiOrigin();
  if (!origin)
    throw new TripError("This build could not connect to NMT Travel.");
  const response = await travelFetch(
    `${origin}/api/trips/${tripId}/travel-files${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new TripError(
      error?.error?.message ??
        "Could not confirm this file request. Reconnect and explicitly retry.",
      response.status,
      error?.error?.fields,
      error?.error?.code,
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new TripError(
      "Could not read the response. Check saved files or explicitly retry the same upload.",
    );
  }
}
export const travelFileApi = {
  list: (
    tripId: string,
    query: { bagId?: string; entryId?: string },
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      `?${new URLSearchParams(query)}`,
      token,
      signal,
      travelFilesResponse,
    ),
  begin: (
    tripId: string,
    body: TravelFileInput,
    token: string,
    signal: AbortSignal,
  ) => request(tripId, "", token, signal, travelUploadResponse, body),
  replace: (
    tripId: string,
    id: string,
    body: UploadDetails,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      `/${id}/uploads`,
      token,
      signal,
      travelUploadResponse,
      body,
    ),
  pending: (tripId: string, id: string, token: string, signal: AbortSignal) =>
    request(tripId, `/${id}/uploads`, token, signal, uploadsResponse),
  finish: async (
    tripId: string,
    id: string,
    uploadId: string,
    token: string,
    signal: AbortSignal,
  ) => {
    const saved = await request(
      tripId,
      `/${id}/uploads/${uploadId}/finalize`,
      token,
      signal,
      travelFileResponse,
      {},
    );
    acceptedTravelChange();
    return saved;
  },
  open: (
    tripId: string,
    id: string,
    version: number | undefined,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      `/${id}/open`,
      token,
      signal,
      openFileResponse,
      version === undefined ? {} : { version },
    ),
  access: (
    tripId: string,
    id: string,
    version: number,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      `/${id}/access`,
      token,
      signal,
      z.object({ file: guideFile }),
      { version },
    ),
  visibility: (
    tripId: string,
    id: string,
    body: { audience: "family" | "trip"; requestId: string },
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      `/${id}/visibility`,
      token,
      signal,
      travelFileResponse,
      body,
    ),
  authorize: (
    tripId: string,
    id: string,
    uploadId: string,
    token: string,
    signal: AbortSignal,
  ) =>
    request(
      tripId,
      `/${id}/uploads/${uploadId}/authorize`,
      token,
      signal,
      fileAuthorization,
      {},
    ),
};
