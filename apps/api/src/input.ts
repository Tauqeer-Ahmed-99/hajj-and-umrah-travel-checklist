import { HttpError } from "./response";

export async function profileJson(request: Request): Promise<unknown> {
  return readJson(request, "profile");
}

export async function editJson<T>(
  request: Request,
  subject: string,
  schema: {
    safeParse(
      value: unknown,
    ):
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: { path: PropertyKey[]; message: string }[] };
        };
  },
): Promise<T> {
  const result = schema.safeParse(await readJson(request, subject));
  if (!result.success)
    throw new HttpError(
      422,
      `invalid_${subject}`,
      `Check the highlighted ${subject} fields.`,
      Object.fromEntries(
        result.error.issues.map((issue) => [
          String(issue.path[0] ?? subject),
          issue.message,
        ]),
      ),
    );
  return result.data;
}

export async function readJson(
  request: Request,
  subject: string,
  maxBytes = 8192,
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
      if (size > maxBytes) {
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
