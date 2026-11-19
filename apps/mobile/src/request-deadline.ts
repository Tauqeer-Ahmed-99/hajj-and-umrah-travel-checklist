import { TripError } from "./request-error";

export class RequestDeadlineError extends Error {}

export function waitForRequest(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve, reject) => {
    const cancelled = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancelled);
      reject(
        new TripError(
          "This request was cancelled.",
          0,
          undefined,
          "request_cancelled",
        ),
      );
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancelled);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancelled, { once: true });
    if (signal.aborted) cancelled();
  });
}

// The caller's cancellation and a stage's deadline are different: only a
// deadline may proceed to a recovery read while the original Save stays active.
export async function withinRequest<T>(
  parent: AbortSignal,
  milliseconds: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    cancel = () => {
      reject(
        new TripError(
          "This request was cancelled.",
          0,
          undefined,
          "request_cancelled",
        ),
      );
      controller.abort();
    };
    parent.addEventListener("abort", cancel, { once: true });
    if (parent.aborted) cancel();
    timer = setTimeout(() => {
      reject(new RequestDeadlineError("This request stage took too long."));
      controller.abort();
    }, milliseconds);
  });
  try {
    return await Promise.race([
      interrupted,
      Promise.resolve().then(() => {
        if (controller.signal.aborted)
          throw new TripError(
            "This request was cancelled.",
            0,
            undefined,
            "request_cancelled",
          );
        return operation(controller.signal);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", cancel);
  }
}

export async function requestToken(
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>,
  signal: AbortSignal,
) {
  try {
    return await withinRequest(signal, 6_000, () => getToken());
  } catch (error) {
    if (signal.aborted) throw error;
    // Clerk's cached token resolver can itself be stuck retrying. A second
    // normal cache lookup would wait on that same promise, so refresh once.
    try {
      return await withinRequest(signal, 6_000, () =>
        getToken({ skipCache: true }),
      );
    } catch (refreshError) {
      if (signal.aborted) throw refreshError;
      throw new TripError(
        "Your sign-in could not be refreshed. Your details are still here. Try again.",
        0,
        undefined,
        "session_refresh_failed",
      );
    }
  }
}
