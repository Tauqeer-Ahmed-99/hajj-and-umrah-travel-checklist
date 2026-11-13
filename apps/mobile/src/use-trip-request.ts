import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/expo";
import { TripError } from "./trip-api";

export function useTripRequest(timeoutMs = 15_000) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TripError | null>(null);
  const active = useRef(true);
  const running = useRef<AbortController | null>(null);
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
                  "The request took too long. Check your connection, then retry.",
                ),
              ),
            { once: true },
          ),
        );
        const result = await Promise.race([
          (async () => {
            const token = await getToken();
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
        if (active.current && !controller.signal.aborted) return result;
      } catch (failure) {
        if (active.current)
          setError(
            failure instanceof TripError
              ? failure
              : new TripError(
                  "Could not reach NMT Travel. Check your connection and retry.",
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
  return { run, busy, error };
}
