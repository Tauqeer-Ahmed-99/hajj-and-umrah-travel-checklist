import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import type { Trip } from "@nmt/contracts";
import { tripApi } from "./trip-api";
import { useTripRequest } from "./use-trip-request";
import { onAcceptedTravelChange } from "./accepted-travel-change";
import { onTripCacheRevoked } from "./trip-cache";

type Catalog = {
  trips: Trip[] | null;
  busy: boolean;
  error: string;
  refresh(): Promise<void>;
};
const Context = createContext<Catalog | null>(null);
// A single authorized catalogue serves all root tabs. Concurrent reads of the
// same scope must not compete with one another's stale-response protection.
export function TripCatalogProvider({ children }: { children: ReactNode }) {
  const api = useTripRequest();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const reading = useRef(false);
  const readAgain = useRef(false);
  const active = useRef(true);
  const refresh = useCallback(async () => {
    if (reading.current) {
      readAgain.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        readAgain.current = false;
        const result = await api.run(tripApi.list);
        if (active.current && result) setTrips(result.trips);
      } while (active.current && readAgain.current);
    } finally {
      reading.current = false;
    }
  }, [api.run]);
  useEffect(() => {
    active.current = true;
    void refresh();
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const changed = onAcceptedTravelChange(() => {
      void refresh();
    });
    const revoked = onTripCacheRevoked((removal) => {
      if (removal.scope === "trip")
        setTrips(
          (previous) =>
            previous?.filter((trip) => trip.id !== removal.tripId) ?? null,
        );
    });
    return () => {
      active.current = false;
      foreground.remove();
      changed();
      revoked();
    };
  }, [refresh]);
  useEffect(() => {
    if (api.error && [401, 403, 404].includes(api.error.status)) setTrips(null);
  }, [api.error]);
  return (
    <Context.Provider
      value={{
        trips,
        busy: api.busy,
        error: api.error?.message ?? "",
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useTripCatalog() {
  const value = useContext(Context);
  if (!value)
    throw new Error("Trip catalogue requires the signed-in workspace.");
  return value;
}
