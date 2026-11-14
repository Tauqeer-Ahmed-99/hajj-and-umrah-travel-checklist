import type { GuideUpload, fileAuthorization } from "@nmt/contracts";
import type { z } from "zod";
import type { File } from "expo-file-system";
import { fetch as fileFetch } from "expo/fetch";
import { TripError } from "./request-error";

export type FileUpload = { id: string; upload: GuideUpload };
type Adapter<T> = {
  prepare?(token: string, signal: AbortSignal): Promise<FileUpload>;
  authorize(
    id: string,
    uploadId: string,
    token: string,
    signal: AbortSignal,
  ): Promise<z.infer<typeof fileAuthorization>>;
  finish(
    id: string,
    uploadId: string,
    token: string,
    signal: AbortSignal,
  ): Promise<T>;
};

// The guide and travel adapters own resource authorization. This controller owns
// the explicit prepare/transfer/confirm lifecycle, including uncertain receipts.
// Calling without bytes is the user's separate "Finish uploaded file" action.
export async function completeFileUpload<T>(
  adapter: Adapter<T>,
  options: {
    session: FileUpload | null;
    file?: File;
    signal: AbortSignal;
    getToken(): Promise<string | null>;
    prepared(value: FileUpload): void;
    phase(value: string): void;
  },
) {
  const { signal } = options;
  const check = () => {
    if (signal.aborted)
      throw new TripError(
        "The upload was interrupted. Check files or explicitly retry the same upload; nothing is queued.",
      );
  };
  const token = async () => {
    const value = await options.getToken();
    check();
    if (!value)
      throw new TripError(
        "Restore your sign-in before retrying this upload.",
        401,
      );
    return value;
  };
  check();
  let selected = options.session;
  if (!selected) {
    if (!options.file || !adapter.prepare)
      throw new TripError("Choose a file before starting an upload.");
    options.phase("Preparing upload…");
    selected = await adapter.prepare(await token(), signal);
    check();
    options.prepared(selected);
  }
  if (options.file && selected.upload.status !== "ready") {
    options.phase("Uploading file…");
    const authorization = await adapter
      .authorize(selected.id, selected.upload.id, await token(), signal)
      .catch((error: unknown) => {
        // Only this exact application receipt means a prior finalize succeeded.
        // Do not rewrite staging, create another version, or treat other 409s as success.
        if (
          error instanceof TripError &&
          error.status === 409 &&
          error.code === "upload_ready"
        )
          return null;
        throw error;
      });
    check();
    if (authorization) {
      if (authorization.method !== "PUT")
        throw new TripError(
          "This upload authorization is not usable. Refresh and retry.",
        );
      const response = await fileFetch(authorization.url, {
        method: "PUT",
        headers: authorization.headers,
        body: options.file,
        signal,
        redirect: "error",
        credentials: "omit",
      });
      check();
      if (!response.ok)
        throw new TripError(
          "The file upload did not finish. Reconnect and explicitly retry the same upload.",
          response.status,
        );
    }
  }
  check();
  options.phase("Checking file…");
  // Always confirm through the resource's idempotent, reauthorizing finalize.
  // Its receipt returns current metadata and cannot replay an older audience/file.
  return adapter.finish(selected.id, selected.upload.id, await token(), signal);
}
