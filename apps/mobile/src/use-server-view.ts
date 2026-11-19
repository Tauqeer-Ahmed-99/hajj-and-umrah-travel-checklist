import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import { useSessionAuth } from "./session-auth";
import { useGuideCopies } from "./guide-copy-context";
import { TripError } from "./request-error";
import { onServerAccessRevoked } from "./server-data";
import { requestToken } from "./request-deadline";

// The view groups related JSON reads. The endpoint queries below it share their
// own data across pages. Neither cache writes JSON to the device filesystem.
export function useServerView<T>(
  path: string,
  identity: readonly unknown[],
  read: (token: string, signal: AbortSignal) => Promise<T>,
  { enabled = true, staleTime = 30_000 } = {},
) {
  const client = useQueryClient(),
    { accountId } = useGuideCopies();
  const { getToken } = useSessionAuth();
  const focused = useIsFocused();
  const [denied, setDenied] = useState<{
    path: string;
    error: TripError;
  } | null>(null);
  const denialVersion = useRef(0);
  useEffect(
    () =>
      onServerAccessRevoked((event) => {
        const prefix =
          event.scope === "family"
            ? `/api/trips/${event.tripId}/families/${event.familyId}`
            : `/api/trips/${event.tripId}`;
        if (
          event.scope !== "records" &&
          (path === prefix || path.startsWith(prefix + "/"))
        ) {
          denialVersion.current++;
          setDenied({
            path,
            error: new TripError(
              event.message ?? "Your access has changed. Refresh to check it.",
              403,
            ),
          });
        }
      }),
    [path],
  );
  const key = ["view", accountId, ...identity];
  const latestKey = useRef(key);
  latestKey.current = key;
  const query = useQuery<T | null, TripError>({
    queryKey: key,
    meta: { path },
    staleTime,
    enabled: focused && enabled,
    subscribed: focused && enabled,
    retry: false,
    queryFn: async ({ signal }) => {
      const token = await requestToken(getToken, signal);
      if (!token) throw new TripError("Sign in again to continue.", 401);
      if (signal.aborted) throw new TripError("This request was cancelled.");
      return read(token, signal);
    },
  });
  const setData = useCallback(
    (change: SetStateAction<T | null>) =>
      client.setQueryData<T | null>(latestKey.current, (previous) => {
        const next =
          typeof change === "function"
            ? (change as (value: T | null) => T | null)(previous ?? null)
            : change;
        // A revocation listener must not recreate a removed query as a fresh
        // null result; returning to an authorized page still needs a real read.
        return previous === undefined && next === null ? undefined : next;
      }),
    [client],
  );
  const refresh = useCallback(async () => {
    const version = denialVersion.current;
    // Invalidate endpoint data before the view read. Refetch never cancels an
    // identical read already in flight, and never submits an old mutation.
    await client.invalidateQueries({
      queryKey: ["server"],
      refetchType: "none",
    });
    const result = await query.refetch({ cancelRefetch: false });
    if (!result.error && result.data && version === denialVersion.current)
      setDenied(null);
  }, [client, query.refetch]);
  const failure = denied?.path === path ? denied.error : query.error;
  const deniedAccess = !!failure && [401, 403, 404].includes(failure.status);
  const transient = !!failure && (!failure.status || failure.status >= 500);
  const hasData = query.data !== undefined && query.data !== null;
  const error = deniedAccess
    ? failure
    : query.isFetching || (hasData && transient)
      ? null
      : failure;
  return {
    data:
      error && [401, 403, 404].includes(error.status)
        ? null
        : (query.data ?? null),
    setData,
    busy: query.isFetching,
    error,
    errorKind: "read" as const,
    refreshError:
      hasData && transient && !query.isFetching && !deniedAccess
        ? failure
        : null,
    refresh,
  };
}
