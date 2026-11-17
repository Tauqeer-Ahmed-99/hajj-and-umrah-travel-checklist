import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

type Connection = {
  status: "checking" | "online" | "offline";
  refreshing: boolean;
  message: string;
};
let connection: Connection = {
  status: "checking",
  refreshing: false,
  message: "",
};
const listeners = new Set<() => void>();
let networkAvailable: boolean | null = null;
export function transportHint(state: {
  isConnected?: boolean;
  isInternetReachable?: boolean;
}): boolean | null {
  return typeof state.isConnected === "boolean" ? state.isConnected : null;
}
export function deviceNetworkAvailable() {
  return networkAvailable;
}
export function setDeviceNetworkAvailable(value: boolean) {
  if (networkAvailable === value) return;
  networkAvailable = value;
  onlineManager.setOnline(value);
  if (!value)
    setConnection({
      status: "offline",
      refreshing: false,
      message:
        "You are offline. Connect to save changes. Saved files remain available.",
    });
  else if (connection.status !== "online")
    setConnection({
      status: "checking",
      refreshing: false,
      message: "",
    });
}
// An HTTP reply is stronger evidence than an Android connectivity hint. It
// proves transport availability, never trip/family authorization.
export function serviceReachable() {
  networkAvailable = true;
  setConnection({ ...connection, status: "online", message: "" });
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
  if (
    connection.status === value.status &&
    connection.refreshing === value.refreshing &&
    connection.message === value.message
  )
    return;
  connection = value;
  tripCacheChanged();
}
export function useTripConnection() {
  return useSyncExternalStore(subscribeTripCache, connectionState);
}
