import {
  fileAuthorization,
  uploadResponse,
  uploadsResponse,
  openFileResponse,
  guideResponse,
  type FileGuideInput,
  type UploadDetails,
} from "@nmt/contracts";
import { guideRequest } from "./guide-api";
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
  authorize: (
    tripId: string,
    id: string,
    uploadId: string,
    token: string,
    signal: AbortSignal,
  ) =>
    guideRequest(
      tripId,
      `/${id}/uploads/${uploadId}/authorize`,
      token,
      signal,
      fileAuthorization,
      "POST",
      {},
    ),
};
