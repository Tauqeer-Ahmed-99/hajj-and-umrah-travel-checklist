import { Directory, File } from "expo-file-system";
import {
  tripResponse,
  itineraryResponse,
  travelersResponse,
  checklistResponse,
  packingResponse,
} from "@nmt/contracts";
import { TripError } from "./request-error";
import {
  connectionState,
  deviceNetworkAvailable,
  setConnection,
  tripCacheChanged,
} from "./trip-cache-state";

// Only complete, unfiltered, authorized read projections belong here. Never cache
// signed URLs, file bytes, rosters of accounts, search results, drafts or writes.
const id = "[a-f0-9-]{36}";
export function snapshotSchema(path: string) {
  if (new RegExp(`^/api/trips/${id}$`).test(path)) return tripResponse;
  if (new RegExp(`^/api/trips/${id}/itinerary$`).test(path))
    return itineraryResponse;
  if (new RegExp(`^/api/trips/${id}/families/${id}/travelers$`).test(path))
    return travelersResponse;
  if (new RegExp(`^/api/trips/${id}/families/${id}/checklist$`).test(path))
    return checklistResponse;
  if (new RegExp(`^/api/trips/${id}/families/${id}/packing$`).test(path))
    return packingResponse;
  return null;
}
type Owner = {
  directory: Directory;
  // Returns the current session controller. Replacing it invalidates old work.
  current(): AbortController;
  completed(): boolean;
  clearAccount(): void;
};
type Cache = {
  owner: Owner;
  generation: number;
  directory: Directory;
  reads: Map<string, number>;
};
type Stamp = { cache: Cache; generation: number; controller: AbortController };
export type TripSnapshot = {
  format: 1;
  path: string;
  refreshedAt: number;
  data: unknown;
};
let active: Cache | null = null;
const revokedListeners = new Set<() => void>();
export function onTripCacheRevoked(listener: () => void) {
  revokedListeners.add(listener);
  return () => {
    revokedListeners.delete(listener);
  };
}

export function startTripCache(owner: Owner) {
  const cache: Cache = {
    owner,
    generation: 0,
    directory: new Directory(owner.directory, "trip-cache"),
    reads: new Map(),
  };
  active = cache;
  setConnection({
    status: "checking",
    refreshing: false,
    message: "Checking current trip access. Cached trips are read only.",
  });
  return () => {
    if (active === cache) {
      active = null;
      cache.generation++;
      setConnection({
        status: "checking",
        refreshing: false,
        message: "Restore your account to open cached trips.",
      });
    }
  };
}
function stamp(): Stamp | null {
  if (!active) return null;
  return {
    cache: active,
    generation: active.generation,
    controller: active.owner.current(),
  };
}
function current(value: Stamp, signal?: AbortSignal, checkGeneration = true) {
  if (
    active !== value.cache ||
    (checkGeneration && value.generation !== value.cache.generation) ||
    value.controller.signal.aborted ||
    signal?.aborted ||
    value.cache.owner.current() !== value.controller
  )
    throw new TripError(
      "This account or its access changed. Refresh before continuing; the outcome of an in-flight save may be uncertain.",
    );
}
const name = (path: string) => `${path.replaceAll("/", "_")}.json`;
export function listTripSnapshots(): TripSnapshot[] {
  const value = stamp();
  if (!value || !value.cache.owner.completed()) return [];
  current(value);
  const directory = value.cache.directory;
  if (!directory.exists) return [];
  if (new File(directory, "discard").exists) return [];
  const snapshots: TripSnapshot[] = [];
  const revoked = directory
    .list()
    .filter((file) => file.name.endsWith(".revoked"))
    .map((file) => file.name.slice(0, -8));
  for (const file of directory.list()) {
    if (!(file instanceof File) || !file.name.endsWith(".json")) continue;
    if (
      revoked.some(
        (prefix) =>
          file.name === `${prefix}.json` || file.name.startsWith(`${prefix}_`),
      )
    )
      continue;
    try {
      const record = JSON.parse(file.textSync());
      const schema = snapshotSchema(record.path);
      if (
        record.format !== 1 ||
        !schema ||
        name(record.path) !== file.name ||
        !Number.isSafeInteger(record.refreshedAt) ||
        record.refreshedAt <= 0
      )
        continue;
      snapshots.push({ ...record, data: schema.parse(record.data) });
    } catch {
      /* Partial or incompatible data never proves a usable snapshot. */
    }
  }
  current(value);
  return snapshots;
}
function publish(
  value: Stamp,
  path: string,
  data: unknown,
  signal?: AbortSignal,
) {
  current(value, signal);
  if (!value.cache.owner.completed()) return;
  const schema = snapshotSchema(path);
  if (!schema) return;
  const record: TripSnapshot = {
    format: 1,
    path,
    refreshedAt: Date.now(),
    data: schema.parse(data),
  };
  const directory = value.cache.directory;
  directory.create({ idempotent: true });
  finishRevokedCleanup(directory);
  // A failed cleanup remains hidden until a subsequent successful cleanup.
  if (new File(directory, "discard").exists) return;
  const pending = new File(directory, `${name(path)}.pending`);
  pending.writeSync(JSON.stringify(record));
  current(value, signal);
  pending.moveSync(new File(directory, name(path)), { overwrite: true });
  tripCacheChanged();
}
export function clearTripCache() {
  const value = stamp();
  if (!value) return;
  value.cache.generation++;
  if (value.cache.directory.exists) {
    new File(value.cache.directory, "discard").writeSync("discard");
    tripCacheChanged();
    value.cache.directory.delete();
  }
  tripCacheChanged();
}
function deny(value: Stamp, path: string, status: number, method: string) {
  current(value, undefined, method === "GET");
  if (status === 401 || (path === "/api/me" && [403, 404].includes(status))) {
    value.cache.generation++;
    value.cache.owner.clearAccount();
    setConnection({
      status: "checking",
      refreshing: false,
      message: "Connect and restore your account before opening private data.",
    });
    return;
  }
  if (method !== "GET" || ![403, 404].includes(status) || !snapshotSchema(path))
    return;
  const parts = path.split("/");
  const prefix =
    parts[4] === "families"
      ? parts.slice(0, 6).join("/")
      : parts.slice(0, 4).join("/");
  // Invalidate *all* pending publications before removing a denied scope. A late
  // success authorized before this denial must not recreate revoked snapshots.
  value.cache.generation++;
  const directory = value.cache.directory;
  directory.create({ idempotent: true });
  // Durable tombstone precedes deletion. An interrupted removal remains hidden
  // after restart, and must finish before a newly authorized read can publish.
  new File(directory, `${prefix.replaceAll("/", "_")}.revoked`).writeSync(
    "revoked",
  );
  tripCacheChanged();
  try {
    finishRevokedCleanup(directory);
  } catch {
    throw new TripError(
      "Private cache cleanup could not finish. Retry Refresh cached trips.",
    );
  } finally {
    for (const listener of revokedListeners) listener();
    tripCacheChanged();
  }
}
function finishRevokedCleanup(directory: Directory) {
  if (!directory.exists) return;
  for (const marker of directory.list()) {
    if (!(marker instanceof File) || !marker.name.endsWith(".revoked"))
      continue;
    const prefix = marker.name.slice(0, -8);
    for (const file of directory.list())
      if (
        file instanceof File &&
        (file.name === `${prefix}.json` || file.name.startsWith(`${prefix}_`))
      )
        file.delete();
    marker.delete();
  }
}

// Every application API client crosses this boundary. GETs remain live reads;
// a disconnected fallback is offered only in the explicitly read-only reader.
export async function travelFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const value = stamp();
  const path = new URL(url).pathname;
  const method = init.method ?? "GET";
  const readAuthorization =
    method === "POST" && /\/(copy-access|open|summary)$/.test(path);
  const cleanup = method === "DELETE" && path === "/api/notifications/device";
  const readNumber =
    value && method === "GET" ? (value.cache.reads.get(path) ?? 0) + 1 : null;
  if (value && readNumber !== null) value.cache.reads.set(path, readNumber);
  if (
    value &&
    method !== "GET" &&
    !readAuthorization &&
    !cleanup &&
    (connectionState().status !== "online" ||
      deviceNetworkAvailable() === false)
  )
    throw new TripError(
      "Trip data is read only until current access is refreshed. Your input stays here; reconnect and explicitly retry. Nothing is queued.",
    );
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (value) {
      current(value);
      setConnection({
        status: "offline",
        refreshing: false,
        message:
          "Connection unavailable. Open cached trips for read-only viewing. Nothing is queued.",
      });
    }
    throw error;
  }
  if (!value) return response;
  current(value, init.signal ?? undefined, method === "GET");
  if (readNumber !== null && value.cache.reads.get(path) !== readNumber)
    throw new TripError(
      "A newer refresh replaced this read. Open the view again.",
    );
  deny(value, path, response.status, method);
  if (
    response.ok &&
    method === "GET" &&
    !new URL(url).search &&
    snapshotSchema(path)
  ) {
    try {
      const data = await response.clone().json();
      if (readNumber !== null && value.cache.reads.get(path) !== readNumber)
        throw new TripError("A newer refresh replaced this read.");
      publish(value, path, data, init.signal ?? undefined);
    } catch (error) {
      current(value, init.signal ?? undefined);
      // A disk/schema error must not turn an accepted server write into a retry.
      setConnection({
        ...connectionState(),
        message:
          "This view could not be kept for offline use. Retry Refresh cached trips while connected.",
      });
    }
  }
  if (readNumber !== null && value.cache.reads.get(path) !== readNumber)
    throw new TripError(
      "A newer refresh replaced this read. Open the view again.",
    );
  return response;
}

export async function refreshTripCache(
  origin: string,
  token: string,
  signal: AbortSignal,
) {
  const value = stamp();
  if (!value) return;
  current(value, signal);
  setConnection({
    ...connectionState(),
    status: "checking",
    refreshing: true,
    message: "Refreshing cached data and current permissions…",
  });
  let unavailable = 0;
  // Retry a discard cleanup before any new publication.
  if (
    value.cache.directory.exists &&
    new File(value.cache.directory, "discard").exists
  ) {
    value.cache.directory.delete();
  }
  finishRevokedCleanup(value.cache.directory);
  const paths = listTripSnapshots().map((record) => record.path);
  for (const path of paths) {
    const attempt = stamp();
    if (
      !attempt ||
      attempt.cache !== value.cache ||
      attempt.controller !== value.controller
    )
      return;
    current(attempt, signal);
    try {
      const response = await travelFetch(`${origin}${path}`, {
        signal,
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok && ![403, 404].includes(response.status)) unavailable++;
    } catch {
      if (signal.aborted)
        throw new TripError(
          "Refresh interrupted. Cached trips remain read only.",
        );
      // A denial may advance the cache generation; continue checks with a fresh
      // stamp, but account/session replacement must end the entire refresh.
      if (
        active !== value.cache ||
        value.controller !== value.cache.owner.current() ||
        value.controller.signal.aborted
      )
        return;
      unavailable++;
    }
  }
  if (
    active !== value.cache ||
    value.controller !== value.cache.owner.current() ||
    value.controller.signal.aborted
  )
    return;
  if (signal.aborted)
    throw new TripError("Refresh interrupted. Cached trips remain read only.");
  setConnection({
    status:
      unavailable || deviceNetworkAvailable() === false ? "offline" : "online",
    refreshing: false,
    message: unavailable
      ? "Some access checks are unavailable. Good cached data was retained; reconnect and retry."
      : "Current trip access checked. Cached views remain read only.",
  });
}
