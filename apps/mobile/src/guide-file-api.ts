import {
  fileAuthorization,
  uploadResponse,
  uploadsResponse,
  openFileResponse,
  guideResponse,
  type FileGuideInput,
  type UploadDetails,
} from "@nmt/contracts";
import { fetch as fileFetch } from "expo/fetch";
import { File } from "expo-file-system";
import { guideRequest } from "./guide-api";
import { TripError } from "./trip-api";
export const guideFileApi = {
  begin: (
    tripId: string,
    body: FileGuideInput,
    token: string,
    signal: AbortSignal,
  ) =>
    guideRequest(
      tripId,
      "/uploads",
      token,
      signal,
      uploadResponse,
      "POST",
      body,
    ),
  replace: (
    tripId: string,
    id: string,
    body: UploadDetails,
    token: string,
    signal: AbortSignal,
  ) =>
    guideRequest(
      tripId,
      `/${id}/uploads`,
      token,
      signal,
      uploadResponse,
      "POST",
      body,
    ),
  pending: (tripId: string, id: string, token: string, signal: AbortSignal) =>
    guideRequest(tripId, `/${id}/uploads`, token, signal, uploadsResponse),
  finish: (
    tripId: string,
    id: string,
    uploadId: string,
    token: string,
    signal: AbortSignal,
  ) =>
    guideRequest(
      tripId,
      `/${id}/uploads/${uploadId}/finalize`,
      token,
      signal,
      guideResponse,
      "POST",
      {},
    ),
  open: (
    tripId: string,
    id: string,
    version: number | undefined,
    token: string,
    signal: AbortSignal,
  ) =>
    guideRequest(
      tripId,
      `/${id}/open`,
      token,
      signal,
      openFileResponse,
      "POST",
      version ? { version } : {},
    ),
  put: async (
    tripId: string,
    id: string,
    uploadId: string,
    file: File,
    token: string,
    signal: AbortSignal,
  ) => {
    const authorization = await guideRequest(
      tripId,
      `/${id}/uploads/${uploadId}/authorize`,
      token,
      signal,
      fileAuthorization,
      "POST",
      {},
    );
    // Only the exact signed R2 operation receives file bytes; never the Clerk token.
    const response = await fileFetch(authorization.url, {
      method: "PUT",
      headers: authorization.headers,
      body: file,
      signal,
      redirect: "error",
      credentials: "omit",
    });
    if (!response.ok)
      throw new TripError(
        "The file upload did not finish. Reconnect and retry this upload.",
        response.status,
      );
  },
};
