import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import type { TripError } from "./request-error";

// Retain a successful view during refresh, but never carry it across resources
// or a confirmed denial. Late callbacks from another resource cannot replace it.
export function useViewState<T>(scope: string, error: TripError | null) {
  const [saved, setSaved] = useState<{ scope: string; value: T | null }>({
    scope,
    value: null,
  });
  const current = useRef(scope);
  current.current = scope;
  const denied = !!error && [401, 403, 404].includes(error.status);
  useEffect(() => {
    if (denied) setSaved({ scope, value: null });
  }, [scope, denied]);
  const setData = useCallback(
    (change: SetStateAction<T | null>) => {
      if (current.current !== scope) return;
      setSaved((previous) => ({
        scope,
        value:
          typeof change === "function"
            ? (change as (previous: T | null) => T | null)(
                previous.scope === scope ? previous.value : null,
              )
            : change,
      }));
    },
    [scope],
  );
  return [
    !denied && saved.scope === scope ? saved.value : null,
    setData,
  ] as const;
}
