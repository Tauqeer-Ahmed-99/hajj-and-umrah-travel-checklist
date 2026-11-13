import { HttpError } from "./response";

export async function profileJson(request: Request): Promise<unknown> {
  return readJson(request, "profile");
}

export async function readJson(
  request: Request,
  subject: string,
): Promise<unknown> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      `Send your ${subject} as JSON.`,
    );
  }
  const reader = request.body?.getReader();
  if (!reader)
    throw new HttpError(
      400,
      "invalid_json",
      `Send valid JSON for your ${subject}.`,
    );
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new HttpError(
          413,
          `${subject}_too_large`,
          `Your ${subject} is too large. Use shorter names.`,
        );
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      `Send valid JSON for your ${subject}.`,
    );
  }
}
