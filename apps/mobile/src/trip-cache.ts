import { Directory, File } from "expo-file-system";
import {
  tripResponse,
  itineraryResponse,
  travelersResponse,
  checklistResponse,
  packingResponse,
  returnPreparationResponse,
  sharedContentResponse,
  overviewResponse,
  completionResponse,
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
function snapshotSchema(path: string) {
  if (new RegExp(`^/api/trips/${id}$`).test(path)) return tripResponse;
  if (new RegExp(`^/api/trips/${id}/itinerary$`).test(path))
    return itineraryResponse;
  if (new RegExp(`^/api/trips/${id}/overview(?:/return)?$`).test(path))
    return overviewResponse.refine(
      (data) =>
        data.query.leg === (path.endsWith("/return") ? "return" : "outbound") &&
        data.query.scope === "all" &&
        !data.query.q &&
        !data.query.attention &&
        !data.query.familyId,
    );
  // Trip-only lifecycle metadata/lessons. Never cache the mixed-permission
  // arrival review, archive listings, private reference labels or file access.
  if (new RegExp(`^/api/trips/${id}/completion$`).test(path))
    return completionResponse;
  const shared = path.match(
    new RegExp(`^/api/trips/${id}/shared\\?leg=(outbound|return)$`),
  );
  if (shared)
    return sharedContentResponse.refine((data) => data.leg === shared[1]);
  if (new RegExp(`^/api/trips/${id}/families/${id}/travelers$`).test(path))
    return travelersResponse;
  if (new RegExp(`^/api/trips/${id}/families/${id}/checklist$`).test(path))
    return checklistResponse;
  const packing = path.match(
    new RegExp(
      `^/api/trips/${id}/families/${id}/packing\\?leg=(outbound|return)$`,
    ),
  );
  if (packing) return packingResponse.refine((data) => data.leg === packing[1]);
  if (
    new RegExp(`^/api/trips/${id}/families/${id}/return-preparation$`).test(
      path,
    )
  )
    return returnPreparationResponse;
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
  blocked: Set<string>;
};
type Stamp = { cache: Cache; generation: number; controller: AbortController };
export type TripSnapshot = {
  format: 1;
  path: string;
  refreshedAt: number;
  data: unknown;
};
export type TripCacheRemoval =
  | { scope: "trip"; tripId: string }
  | { scope: "family"; tripId: string; familyId: string }
  | {
      scope: "records";
      tripId: string;
      projection: "family" | "shared";
      recordIds: string[];
    };
let active: Cache | null = null;
const revokedListeners = new Set<(removal: TripCacheRemoval) => void>();
export function onTripCacheRevoked(
  listener: (removal: TripCacheRemoval) => void,
) {
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
    blocked: new Set(),
  };
  if (cache.directory.exists && new File(cache.directory, "discard").exists)
    cache.directory.delete();
  finishRevokedCleanup(cache.directory);
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
function cachePath(url: URL) {
  if (/\/(packing|shared)$/.test(url.pathname)) {
    const leg = url.searchParams.get("leg") ?? "outbound";
    if (
      (!url.search ||
        (url.searchParams.size === 1 && url.searchParams.has("leg"))) &&
      ["outbound", "return"].includes(leg)
    )
      return `${url.pathname}?leg=${leg}`;
  }
  return `${url.pathname}${url.search}`;
}
const name = (path: string) =>
  `${path.replaceAll("/", "_").replaceAll("?", "_").replaceAll("=", "_")}.json`;
export function listTripSnapshots(): TripSnapshot[] {
  const value = stamp();
  if (!value || !value.cache.owner.completed()) return [];
  current(value);
  const directory = value.cache.directory;
  if (!directory.exists) return [];
  if (new File(directory, "discard").exists) return [];
  const snapshots: TripSnapshot[] = [];
  const revoked = [
    ...value.cache.blocked,
    ...directory
      .list()
      .filter((file) => file.name.endsWith(".revoked"))
      .map((file) => file.name.slice(0, -8)),
  ];
  for (const file of directory.list()) {
    if (!(file instanceof File) || !file.name.endsWith(".json")) continue;
    if (
      revoked.some(
        (prefix) =>
          file.name === `${prefix}.json` ||
          file.name.startsWith(`${prefix}_`) ||
          (prefix.includes("_families_") &&
            file.name.startsWith(
              `${prefix.split("_families_")[0]}_overview`,
            )) ||
          (prefix.endsWith("_shared") &&
            file.name.startsWith(`${prefix.slice(0, -7)}_overview`)),
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
      const data = schema.parse(record.data);
      if ("families" in data && "trip" in data)
        data.families = data.families.filter(
          (family) =>
            !revoked.includes(
              `${record.path.replaceAll("/", "_")}_families_${family.id}`,
            ),
        );
      snapshots.push({ ...record, data });
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
  let lostSharedAccess = false;
  let removedShared: { items: string[]; bags: string[] } = {
    items: [],
    bags: [],
  };
  let lostFamilyAccess = false;
  let lostOverviewAccess = false;
  let removedFamilies: string[] = [];
  let removedFamilyRecords: string[] = [];
  if (/\/overview(?:\/return)?$/.test(path)) {
    try {
      const previous = overviewResponse.parse(
        JSON.parse(new File(directory, name(path)).textSync()).data,
      );
      const next = overviewResponse.parse(record.data);
      const removed = previous.records.filter((row) => {
        const replacement = next.records.find(
          (n) => n.id === row.id && n.kind === row.kind,
        );
        return (
          !replacement ||
          (row.access === "family" && replacement.access !== "family") ||
          (row.shared && !replacement.shared)
        );
      });
      removedFamilyRecords = removed
        .filter(
          (row) =>
            row.access === "family" &&
            !next.records.some((n) => n.id === row.id && n.access === "family"),
        )
        .map((row) => row.id);
      lostOverviewAccess = removed.length > 0;
      // A complete overview can also withdraw a shared row. Partial searches
      // never enter publish; no omitted record proves loss of the whole scope.
      for (const row of removed) {
        const nextRow = next.records.find(
          (n) => n.id === row.id && n.kind === row.kind,
        );
        if (row.shared && !nextRow?.shared) {
          if (row.kind === "bag") removedShared.bags.push(row.id);
          if (row.kind === "item" || row.kind === "task")
            removedShared.items.push(row.id);
        }
      }
    } catch {
      /* No previous complete overview for this leg. */
    }
  }
  if (new RegExp(`^/api/trips/${id}$`).test(path)) {
    try {
      const previous = tripResponse.parse(
        JSON.parse(new File(directory, name(path)).textSync()).data,
      );
      const next = tripResponse.parse(record.data);
      const removed = previous.families.filter(
        (f) => !next.families.some((n) => n.id === f.id),
      );
      for (const family of removed) {
        const scope = `${path}/families/${family.id}`.replaceAll("/", "_");
        value.cache.blocked.add(scope);
        new File(directory, `${scope}.revoked`).writeSync("revoked");
        finishRevokedCleanup(directory);
        value.cache.blocked.delete(scope);
      }
      lostFamilyAccess = removed.length > 0;
      removedFamilies = removed.map((family) => family.id);
    } catch {
      if (value.cache.blocked.size) {
        value.cache.owner.clearAccount();
        throw new TripError(
          "Private cache cleanup did not finish. Restore current access before opening private data.",
        );
      }
    }
  }
  if (/\/shared\?leg=(outbound|return)$/.test(path)) {
    try {
      const previous = sharedContentResponse.parse(
        JSON.parse(new File(directory, name(path)).textSync()).data,
      );
      const next = sharedContentResponse.parse(record.data);
      removedShared = {
        items: previous.items
          .filter(
            (item) => !next.items.some((n) => n.entry.id === item.entry.id),
          )
          .map((item) => item.entry.id),
        bags: previous.bags
          .filter((bag) => !next.bags.some((n) => n.id === bag.id))
          .map((bag) => bag.id),
      };
    } catch {
      /* No prior compatible shared snapshot. */
    }
  }
  lostSharedAccess =
    removedShared.items.length > 0 || removedShared.bags.length > 0;
  if (lostSharedAccess) {
    // One durable marker covers BOTH leg projections before either is published.
    // Redact only the withdrawn shared rows; private family snapshots and other
    // shared records retain their independent authorization and refresh times.
    value.generation = ++value.cache.generation;
    const scope = `${path.split("/").slice(0, 4).join("/")}/shared`.replaceAll(
      "/",
      "_",
    );
    value.cache.blocked.add(scope);
    try {
      new File(directory, `${scope}.revoked`).writeSync(
        JSON.stringify(removedShared),
      );
      finishRevokedCleanup(directory);
      value.cache.blocked.delete(scope);
    } catch {
      value.cache.owner.clearAccount();
      throw new TripError(
        "Shared cache cleanup did not finish. Restore current access before opening private data.",
      );
    }
  }
  if (lostSharedAccess || lostOverviewAccess) {
    // A full shared projection may revoke an item/bag without denying the trip.
    // Persist a composite tombstone before deleting either leg's older overview.
    const scope =
      `${path.split("/").slice(0, 4).join("/")}/overview`.replaceAll("/", "_");
    value.cache.blocked.add(scope);
    try {
      new File(directory, `${scope}.revoked`).writeSync("revoked");
      finishRevokedCleanup(directory);
      value.cache.blocked.delete(scope);
    } catch {
      value.cache.owner.clearAccount();
      throw new TripError(
        "Overview cleanup did not finish. Restore current access before opening private data.",
      );
    }
  }
  if (lostSharedAccess || lostFamilyAccess || lostOverviewAccess)
    value.generation = ++value.cache.generation;
  const pending = new File(directory, `${name(path)}.pending`);
  pending.writeSync(JSON.stringify(record));
  current(value, signal);
  pending.moveSync(new File(directory, name(path)), { overwrite: true });
  const tripId = path.split("/")[3];
  for (const familyId of removedFamilies)
    for (const listener of revokedListeners)
      listener({ scope: "family", tripId, familyId });
  const sharedIds = [
    ...new Set([...removedShared.items, ...removedShared.bags]),
  ];
  if (sharedIds.length)
    for (const listener of revokedListeners)
      listener({
        scope: "records",
        tripId,
        projection: "shared",
        recordIds: sharedIds,
      });
  if (removedFamilyRecords.length)
    for (const listener of revokedListeners)
      listener({
        scope: "records",
        tripId,
        projection: "family",
        recordIds: removedFamilyRecords,
      });
  tripCacheChanged();
}
export function clearTripCache() {
  const value = stamp();
  if (!value) return;
  value.cache.generation++;
  if (value.cache.directory.exists) {
    try {
      new File(value.cache.directory, "discard").writeSync("discard");
      tripCacheChanged();
      value.cache.directory.delete();
    } catch (error) {
      value.cache.owner.clearAccount();
      throw error;
    }
  }
  value.cache.blocked.clear();
  tripCacheChanged();
}
function deny(
  value: Stamp,
  path: string,
  status: number,
  method: string,
  code?: string,
) {
  current(value, undefined, method === "GET");
  if (
    status === 401 ||
    ["profile_incomplete", "email_unverified", "account_removed"].includes(
      code ?? "",
    ) ||
    (path === "/api/me" && [403, 404].includes(status))
  ) {
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
  const encodedPrefix = prefix.replaceAll("/", "_");
  value.cache.blocked.add(encodedPrefix);
  const directory = value.cache.directory;
  // Durable tombstone precedes deletion. An interrupted removal remains hidden
  // after restart, and must finish before a newly authorized read can publish.
  tripCacheChanged();
  try {
    directory.create({ idempotent: true });
    new File(directory, `${encodedPrefix}.revoked`).writeSync("revoked");
    finishRevokedCleanup(directory);
    value.cache.blocked.delete(encodedPrefix);
  } catch {
    // If even the tombstone cannot be written, invalidate the account gate as
    // well. Keep old callbacks unable to open or publish private data.
    value.cache.owner.clearAccount();
    throw new TripError(
      "Private cache cleanup could not finish. Retry Refresh cached trips.",
    );
  } finally {
    for (const listener of revokedListeners)
      listener(
        parts[4] === "families"
          ? { scope: "family", tripId: parts[3], familyId: parts[5] }
          : { scope: "trip", tripId: parts[3] },
      );
    tripCacheChanged();
  }
}
function finishRevokedCleanup(directory: Directory) {
  if (!directory.exists) return;
  for (const marker of directory.list()) {
    if (!(marker instanceof File) || !marker.name.endsWith(".revoked"))
      continue;
    const prefix = marker.name.slice(0, -8);
    if (prefix.endsWith("_shared")) {
      const removed: { items: string[]; bags: string[] } = JSON.parse(
        marker.textSync(),
      );
      if (!Array.isArray(removed.items) || !Array.isArray(removed.bags))
        throw new TripError(
          "Shared cache cleanup must finish before opening cached data.",
        );
      for (const file of directory.list()) {
        if (!(file instanceof File)) continue;
        if (file.name.startsWith(`${prefix.slice(0, -7)}_overview`))
          file.delete();
        if (!file.name.startsWith(`${prefix}_`) || !file.name.endsWith(".json"))
          continue;
        try {
          const record = JSON.parse(file.textSync());
          const shared = sharedContentResponse.parse(record.data);
          shared.items = shared.items.filter(
            (item) => !removed.items.includes(item.entry.id),
          );
          shared.bags = shared.bags.filter(
            (bag) => !removed.bags.includes(bag.id),
          );
          for (const item of shared.items) {
            if (item.packing)
              item.packing.allocations = item.packing.allocations.map(
                (allocation) => ({
                  ...allocation,
                  location:
                    allocation.location.kind === "bag" &&
                    removed.bags.includes(allocation.location.id)
                      ? {
                          kind: "private" as const,
                          label: "Private carrying location",
                        }
                      : allocation.location,
                }),
              );
          }
          shared.history = shared.history.filter(
            (event) =>
              !removed.items.includes(event.entryId ?? "") &&
              !event.bagIds.some((id) => removed.bags.includes(id)),
          );
          const pending = new File(directory, `${file.name}.pending`);
          pending.writeSync(JSON.stringify({ ...record, data: shared }));
          pending.moveSync(file, { overwrite: true });
        } catch {
          // A corrupt projection cannot keep revoked content visible.
          file.delete();
        }
      }
      marker.delete();
      continue;
    }
    // A definitive family denial also removes its name/navigation from an older
    // trip detail. Retain the original refresh time: redaction is not a new read.
    const familyScope = prefix.match(
      /^_api_trips_([a-f0-9-]{36})_families_([a-f0-9-]{36})$/,
    );
    if (familyScope) {
      for (const file of directory.list())
        if (
          file instanceof File &&
          file.name.startsWith(`_api_trips_${familyScope[1]}_overview`)
        )
          file.delete();
      const detailFile = new File(
        directory,
        `_api_trips_${familyScope[1]}.json`,
      );
      if (detailFile.exists) {
        try {
          const record = JSON.parse(detailFile.textSync());
          const detail = tripResponse.parse(record.data);
          detail.families = detail.families.filter(
            (family) => family.id !== familyScope[2],
          );
          const pending = new File(directory, `${detailFile.name}.pending`);
          pending.writeSync(JSON.stringify({ ...record, data: detail }));
          pending.moveSync(detailFile, { overwrite: true });
        } catch {
          // Never leave a denied family's name behind if redaction fails.
          detailFile.delete();
        }
      }
    }
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
  const path = cachePath(new URL(url));
  const method = init.method ?? "GET";
  const readAuthorization =
    method === "POST" &&
    (/\/(copy-access|open|summary)$/.test(path) ||
      /^\/api\/trips\/[^/]+\/travel-files\/[^/]+\/access$/.test(path));
  const cleanup =
    (method === "DELETE" && path === "/api/notifications/device") ||
    (path === "/api/me/removal" &&
      new Headers(init.headers).get("Authorization")?.startsWith("Removal ") ===
        true);
  // Explicit unregistration must still work after local account invalidation.
  // Its exact token is authorized on the server, and its response owns no cache.
  const value = cleanup ? null : stamp();
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
  let denialCode: string | undefined;
  if ([401, 403, 404].includes(response.status)) {
    try {
      const body = await response.clone().json();
      if (
        typeof body.error?.code === "string" &&
        typeof body.error?.message === "string"
      )
        denialCode = body.error.code;
    } catch {
      /* A proxy/HTML error is not an application permission decision. */
    }
    current(value, init.signal ?? undefined, method === "GET");
    if (
      !denialCode ||
      ((method === "GET" || readAuthorization) &&
        ![
          "invalid_session",
          "profile_incomplete",
          "email_unverified",
          "account_removed",
          "not_found",
          "trip_forbidden",
          "family_forbidden",
          "guide_forbidden",
        ].includes(denialCode))
    )
      throw new TripError(
        "Current access could not be checked. Your cached data was retained; reconnect and retry.",
      );
  }
  if (readNumber !== null && value.cache.reads.get(path) !== readNumber)
    throw new TripError(
      "A newer refresh replaced this access check. Open the view again.",
    );
  // A filtered overview can deny a selected family/item while trip access stays
  // valid. Only complete resource reads establish a cache-scope denial.
  deny(
    value,
    path,
    response.status,
    method === "GET" && !snapshotSchema(path) ? "FILTERED_GET" : method,
    denialCode,
  );
  if (response.ok && method === "GET" && snapshotSchema(path)) {
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
  value.cache.blocked.clear();
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
    const read = new AbortController();
    const abort = () => read.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) read.abort();
    const timeout = setTimeout(abort, 15_000);
    try {
      const response = await travelFetch(`${origin}${path}`, {
        signal: read.signal,
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
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
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
