import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionAuth } from "./session-auth";
import { TripError } from "./trip-api";
import { requestToken } from "./request-deadline";

export function useTripRequest(timeoutMs = 35_000, requestScope?: string) {
  const { getToken } = useSessionAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TripError | null>(null);
  const active = useRef(true);
  const running = useRef<AbortController | null>(null);
  const scope = useRef(requestScope);
  const tokenSource = useRef(getToken);
  scope.current = requestScope;
  tokenSource.current = getToken;
  useEffect(() => {
    running.current?.abort();
  }, [requestScope, getToken]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      running.current?.abort();
    };
  }, []);
  const run = useCallback(
    async <T>(
      operation: (token: string, signal: AbortSignal) => Promise<T>,
    ): Promise<T | undefined> => {
      if (running.current) return;
      const controller = new AbortController();
      const startedScope = scope.current;
      running.current = controller;
      setBusy(true);
      setError(null);
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Race token retrieval too: a stalled provider must not leave Save disabled.
        const aborted = new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () =>
              reject(
                new TripError(
                  "This request took too long. Your details are still here. Try again.",
                ),
              ),
            { once: true },
          ),
        );
        const result = await Promise.race([
          (async () => {
            const token = await requestToken(getToken, controller.signal);
            if (!token)
              throw new TripError(
                "Your session has ended. Open Account and sign in again.",
                401,
              );
            if (controller.signal.aborted)
              throw new TripError("The request was interrupted.");
            return operation(token, controller.signal);
          })(),
          aborted,
        ]);
        if (
          active.current &&
          !controller.signal.aborted &&
          tokenSource.current === getToken &&
          startedScope === scope.current
        )
          return result;
      } catch (failure) {
        if (
          active.current &&
          tokenSource.current === getToken &&
          startedScope === scope.current
        )
          setError(
            failure instanceof TripError
              ? failure
              : new TripError(
                  "This request could not reach the server. Try again.",
                ),
          );
      } finally {
        clearTimeout(timer);
        running.current = null;
        if (active.current) setBusy(false);
      }
    },
    [getToken, timeoutMs],
  );
  // Connectivity gates submissions in Action/travelFetch. A permission refresh
  // must not disable a draft's native input and make it lose keyboard focus.
  return { run, busy, error };
}
