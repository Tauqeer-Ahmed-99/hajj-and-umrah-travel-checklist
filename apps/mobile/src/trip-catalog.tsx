import { createContext, useContext, type ReactNode } from "react";
import type { Trip } from "@nmt/contracts";
import { tripApi } from "./trip-api";
import { useServerView } from "./use-server-view";
type Catalog = {
  trips: Trip[] | null;
  busy: boolean;
  error: string;
  refresh(): Promise<void>;
};
const Context = createContext<Catalog | null>(null);
export function TripCatalogProvider({ children }: { children: ReactNode }) {
  const query = useServerView("/api/trips", ["trips"], tripApi.list, {
    staleTime: 120_000,
  });
  return (
    <Context.Provider
      value={{
        trips: query.data?.trips ?? null,
        busy: query.busy,
        error: query.error?.message ?? "",
        refresh: query.refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useTripCatalog() {
  const value = useContext(Context);
  if (!value) throw new Error("Trips require the signed-in workspace.");
  return value;
}
