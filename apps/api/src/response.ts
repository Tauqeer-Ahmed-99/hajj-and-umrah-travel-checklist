import type { ApiError } from "@nmt/contracts";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function failure(error: unknown) {
  const known =
    error instanceof HttpError
      ? error
      : new HttpError(
          503,
          "service_unavailable",
          "Your profile could not be loaded or saved. Check your connection and try again.",
        );
  if (!(error instanceof HttpError))
    console.error("Account request failed", {
      name: error instanceof Error ? error.name : "unknown",
    });
  const body: ApiError = {
    error: {
      code: known.code,
      message: known.message,
      ...(known.fields ? { fields: known.fields } : {}),
    },
  };
  return json(body, known.status);
}
