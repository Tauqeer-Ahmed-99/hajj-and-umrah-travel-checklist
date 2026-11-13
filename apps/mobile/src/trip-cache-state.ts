import { useSyncExternalStore } from "react";

type Connection = {
  status: "checking" | "online" | "offline";
  refreshing: boolean;
  message: string;
};
let connection: Connection = {
  status: "checking",
  refreshing: false,
  message: "Connect to check current access before changing trip data.",
};
const listeners = new Set<() => void>();
let networkAvailable: boolean | null = null;
export function deviceNetworkAvailable() {
  return networkAvailable;
}
export function setDeviceNetworkAvailable(value: boolean) {
  networkAvailable = value;
  if (!value)
    setConnection({
      status: "offline",
      refreshing: false,
      message:
        "Offline · trip data is read only. Open cached trips or saved guides. Reconnect to refresh access and resume editing.",
    });
  else
    setConnection({
      status: "checking",
      refreshing: false,
      message:
        "Connection restored. Checking current access before enabling changes…",
    });
}
export function subscribeTripCache(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function tripCacheChanged() {
  for (const listener of listeners) listener();
}
export function connectionState() {
  return connection;
}
export function setConnection(value: Connection) {
  connection = value;
  tripCacheChanged();
}
export function useTripConnection() {
  return useSyncExternalStore(subscribeTripCache, connectionState);
}
