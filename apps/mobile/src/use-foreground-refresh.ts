import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { getServerQueryClient } from "./server-data";
// Read-only refreshes share their in-flight work. They never queue a save.
// A changed read (for example another travel leg) follows the previous read;
// callers still guard publication with their resource/scope identity.
export function useForegroundRefresh(
  load: () => Promise<void>,
  enabled = true,
) {
  const focused = useIsFocused();
  const flight = useRef<{ load: typeof load; promise: Promise<void> } | null>(
    null,
  );
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const refresh = useCallback(
    (force = true) => {
      if (flight.current?.load === load) return flight.current.promise;
      if (force)
        void getServerQueryClient().invalidateQueries({ refetchType: "none" });
      const previous = flight.current?.promise;
      const promise = (
        previous ? previous.catch(() => {}) : Promise.resolve()
      ).then(() => {
        if (active.current) return load();
      });
      const current = { load, promise };
      flight.current = current;
      void promise
        .finally(() => {
          if (flight.current === current) flight.current = null;
        })
        .catch(() => {});
      return promise;
    },
    [load],
  );
  useEffect(() => {
    if (!focused || !enabled) return;
    void refresh(false);
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh(false);
    });
    return () => listener.remove();
  }, [refresh, focused, enabled]);
  return refresh;
}
