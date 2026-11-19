import { QueryCache, QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  tripResponse,
  tripsResponse,
  sharedContentResponse,
  overviewResponse,
} from "@nmt/contracts";
import { TripError } from "./request-error";
import { RequestDeadlineError, withinRequest } from "./request-deadline";
import { serviceReachable } from "./trip-cache-state";

type JsonReply = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};
type Owner = { current(): AbortController; clearAccount(): void };
type Session = {
  owner: Owner;
  controller: AbortController;
  client: QueryClient;
  key: number;
  scope: { revoked: boolean };
};
export type AccessRemoval = (
  | { scope: "trip"; tripId: string }
  | { scope: "family"; tripId: string; familyId: string }
  | {
      scope: "records";
      tripId: string;
      projection: "family" | "shared";
      recordIds: string[];
    }
) & { message?: string };
const listeners = new Set<(event: AccessRemoval) => void>();
let active: Session | null = null,
  nextSession = 0;
const fallback = createServerQueryClient();
class ServerReplyError extends TripError {
  constructor(public reply: JsonReply) {
    const body = reply.body as {
      error?: {
        message?: string;
        code?: string;
        fields?: Record<string, string>;
      };
    };
    super(
      body?.error?.message ??
        "The server could not finish this request. Try again.",
      reply.status,
      body?.error?.fields,
      body?.error?.code,
    );
  }
}
export function createServerQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (
          active &&
          query.queryKey[1] === active.key &&
          error instanceof ServerReplyError &&
          query.meta?.path
        )
          removeDeniedAccess(active, String(query.meta.path), error);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        retry: (count, error) =>
          count < 1 &&
          (!(error instanceof TripError) ||
            error.status === 0 ||
            error.status >= 500),
        retryDelay: 500,
        networkMode: "always",
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      // A failed save needs an explicit retry with its original request ID.
      mutations: { retry: false, networkMode: "always" },
    },
  });
}
export function getServerQueryClient() {
  return currentSession()?.client ?? fallback;
}
function currentSession() {
  const session = active;
  if (!session || session.scope.revoked) return session;
  const controller = session.owner.current();
  if (controller !== session.controller) {
    // Clearing managed file copies rotates their cancellation controller. A
    // later request gets a fresh cache generation; earlier replies stay fenced
    // out by their original session/controller. An expired login never renews.
    session.client.clear();
    active = { ...session, controller, key: ++nextSession };
  }
  return active;
}
export function startServerData(
  owner: Owner,
  client = createServerQueryClient(),
) {
  active?.client.clear();
  fallback.clear();
  const session: Session = {
    owner,
    controller: owner.current(),
    client,
    key: ++nextSession,
    scope: { revoked: false },
  };
  active = session;
  return () => {
    session.client.clear();
    if (active?.scope === session.scope) active = null;
  };
}
export function onServerAccessRevoked(
  listener: (event: AccessRemoval) => void,
) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const emit = (event: AccessRemoval) => {
  for (const listener of listeners) listener(event);
};
function assertSession(session: Session | null, signal?: AbortSignal) {
  if (
    signal?.aborted ||
    (session &&
      (active !== session ||
        session.scope.revoked ||
        session.controller.signal.aborted ||
        session.owner.current() !== session.controller))
  )
    throw new TripError(
      "This request was cancelled. Open the page again if needed.",
      0,
      undefined,
      "request_cancelled",
    );
}
export function serverAccountFence() {
  const session = currentSession();
  return () => {
    if (currentSession() !== session)
      throw new TripError(
        "This request was cancelled. Open the page again if needed.",
        0,
        undefined,
        "request_cancelled",
      );
    assertSession(session);
  };
}
export function serverStaleTime(path: string) {
  // Reconnect/share checks and file-version checks must use current access.
  if (
    /\/summary(?:\?|$)/.test(path) ||
    /\/travel-reminders(?:\?|$)/.test(path) ||
    /\/checklist\/entries\?requestId=/.test(path) ||
    /\/guides\/[a-f0-9-]{36}(?:\/|\?|$)/.test(path) ||
    /\/travel-files(?:\/|\?|$)/.test(path)
  )
    return 0;
  if (
    /^\/api\/me(?:$|\/removal)/.test(path) ||
    /\/(members|invitations|access)(?:\?|$|\/)/.test(path)
  )
    return 30_000;
  if (/\/(history|activity)(?:\?|$|\/)/.test(path)) return 60_000;
  if (
    /\/(checklist|packing|acquisition|return-preparation|overview|shared|reminders|notifications|travelers|travel-steps|updates)(?:\?|$|\/)/.test(
      path,
    )
  )
    return 30_000;
  return 2 * 60_000;
}
export function serverQueryKey(url: string): QueryKey {
  const target = new URL(url);
  return [
    "server",
    currentSession()?.key ?? 0,
    target.origin,
    target.pathname + target.search,
  ];
}
export function invalidateServerData(tripId?: string) {
  const client = getServerQueryClient();
  return client.invalidateQueries({
    predicate: (q) =>
      !tripId ||
      q.meta?.path === "/api/trips" ||
      String(q.meta?.path ?? "").startsWith(`/api/trips/${tripId}`),
    refetchType: "active",
  });
}
function pathOf(key: QueryKey) {
  return typeof key[3] === "string" ? key[3] : "";
}
function drop(
  session: Session,
  matches: (path: string) => boolean,
  except?: string,
) {
  const filters = {
    predicate: (query: {
      queryKey: QueryKey;
      meta?: Record<string, unknown>;
    }) => {
      const path =
        typeof query.meta?.path === "string"
          ? query.meta.path
          : pathOf(query.queryKey);
      return path !== except && matches(path);
    },
  };
  void session.client.cancelQueries(filters);
  session.client.removeQueries(filters);
}
function redactFamilyRecords(
  session: Session,
  base: string,
  ids: Set<string>,
  except: string,
) {
  const filters = {
    predicate: (query: { meta?: Record<string, unknown> }) => {
      const path = String(query.meta?.path ?? "");
      return (
        path !== except &&
        (path.startsWith(base + "/families/") ||
          path.startsWith(base + "/overview"))
      );
    },
  };
  // Cancel earlier reads before removing the withdrawn records from every
  // cached leg/filter. The next read obtains current totals and permissions.
  void session.client.cancelQueries(filters);
  const withdrawn = (value: unknown) => {
    if (!value || typeof value !== "object") return false;
    const row = value as Record<string, unknown>;
    return (
      ["id", "entryId", "entityId"].some(
        (key) => typeof row[key] === "string" && ids.has(row[key] as string),
      ) ||
      (Array.isArray(row.bagIds) &&
        row.bagIds.some((id) => ids.has(String(id))))
    );
  };
  const redact = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.filter((row) => !withdrawn(row)).map(redact)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([key, nested]) => [key, redact(nested)]),
          )
        : value;
  session.client.setQueriesData(filters, redact);
  void session.client.invalidateQueries({ ...filters, refetchType: "none" });
}
function removeDeniedAccess(
  session: Session,
  path: string,
  error: TripError,
  method = "GET",
) {
  const body = error as ServerReplyError;
  const code = (body.reply?.body as { error?: { code?: string } })?.error?.code;
  if (
    ![
      "invalid_session",
      "profile_incomplete",
      "email_unverified",
      "account_removed",
      "not_found",
      "trip_forbidden",
      "family_forbidden",
      "guide_forbidden",
    ].includes(code ?? "")
  )
    return;
  if (
    error.status === 401 ||
    ["profile_incomplete", "email_unverified", "account_removed"].includes(
      code ?? "",
    )
  ) {
    session.scope.revoked = true;
    session.client.clear();
    session.owner.clearAccount();
    return;
  }
  const parts = path.split("/"),
    tripId = parts[3];
  if (!tripId || ![403, 404].includes(error.status)) return;
  const target = new URL(path, "https://travel-companion.invalid");
  const overviewFamily = /\/overview(?:\/return)?$/.test(target.pathname)
    ? target.searchParams.get("familyId")
    : null;
  if (
    method === "GET" &&
    overviewFamily &&
    /^[a-f0-9-]{36}$/.test(overviewFamily)
  ) {
    // A family-filtered overview cannot establish loss of the whole trip.
    drop(
      session,
      (p) =>
        p.startsWith(`/api/trips/${tripId}/families/${overviewFamily}`) ||
        p === `/api/trips/${tripId}` ||
        p.startsWith(`/api/trips/${tripId}/overview`),
    );
    emit({
      scope: "family",
      tripId,
      familyId: overviewFamily,
      message: error.message,
    });
    return;
  }
  // A viewer can still read after an organizer-only action is refused. Only
  // complete read projections establish loss of the underlying read grant.
  const pathname = path.split("?")[0];
  const authoritative =
    method === "GET" &&
    (/^\/api\/trips\/[a-f0-9-]{36}(?:\/(?:itinerary|completion|shared|overview(?:\/return)?))?$/.test(
      pathname,
    ) ||
      /^\/api\/trips\/[a-f0-9-]{36}\/families\/[a-f0-9-]{36}\/(?:travelers|checklist|packing|return-preparation)$/.test(
        pathname,
      ));
  if (!authoritative) {
    void session.client.invalidateQueries({
      predicate: (q) =>
        String(q.meta?.path ?? "").startsWith(`/api/trips/${tripId}`),
      refetchType: "none",
    });
    return;
  }
  if (parts[4] === "families" && parts[5]) {
    const familyId = parts[5];
    drop(
      session,
      (p) =>
        p.startsWith(`/api/trips/${tripId}/families/${familyId}`) ||
        p === `/api/trips/${tripId}` ||
        p.startsWith(`/api/trips/${tripId}/overview`),
    );
    emit({ scope: "family", tripId, familyId, message: error.message });
  } else if (
    parts.length === 4 ||
    ["trip_forbidden", "not_found"].includes(code ?? "")
  ) {
    drop(
      session,
      (p) => p === "/api/trips" || p.startsWith(`/api/trips/${tripId}`),
    );
    emit({ scope: "trip", tripId, message: error.message });
  } else drop(session, (p) => p === path);
}
// Only complete projections can prove a record was withdrawn. Search results
// and filtered views never revoke a whole family or trip.
function reconcileAccess(
  session: Session,
  path: string,
  body: unknown,
  previous: JsonReply | undefined,
) {
  if (path === "/api/trips") {
    const before = tripsResponse.safeParse(previous?.body),
      after = tripsResponse.safeParse(body);
    if (before.success && after.success)
      for (const trip of before.data.trips.filter(
        (t) => !after.data.trips.some((n) => n.id === t.id),
      )) {
        drop(session, (p) => p.startsWith(`/api/trips/${trip.id}`), path);
        emit({ scope: "trip", tripId: trip.id });
      }
  }
  const base = path.split("/").slice(0, 4).join("/"),
    tripId = path.split("/")[3];
  if (!tripId) return;
  if (/^\/api\/trips\/[a-f0-9-]{36}$/.test(path)) {
    const before = tripResponse.safeParse(previous?.body),
      after = tripResponse.safeParse(body);
    if (before.success && after.success)
      for (const family of before.data.families.filter(
        (f) => !after.data.families.some((n) => n.id === f.id),
      )) {
        drop(
          session,
          (p) =>
            p.startsWith(`${base}/families/${family.id}`) ||
            p.startsWith(`${base}/overview`),
          path,
        );
        emit({ scope: "family", tripId, familyId: family.id });
      }
  }
  const sharedIds = new Set<string>(),
    familyIds = new Set<string>();
  if (/\/shared\?leg=(outbound|return)$/.test(path)) {
    const after = sharedContentResponse.safeParse(body);
    if (after.success)
      for (const query of session.client.getQueryCache().findAll()) {
        if (!pathOf(query.queryKey).startsWith(base + "/shared?leg=")) continue;
        const before = sharedContentResponse.safeParse(
          (query.state.data as JsonReply | undefined)?.body,
        );
        if (!before.success) continue;
        for (const item of before.data.items)
          if (!after.data.items.some((n) => n.entry.id === item.entry.id))
            sharedIds.add(item.entry.id);
        for (const bag of before.data.bags)
          if (!after.data.bags.some((n) => n.id === bag.id))
            sharedIds.add(bag.id);
      }
  }
  if (/\/overview(?:\/return)?$/.test(path)) {
    const before = overviewResponse.safeParse(previous?.body),
      after = overviewResponse.safeParse(body);
    if (
      before.success &&
      after.success &&
      after.data.query.scope === "all" &&
      !after.data.query.q &&
      !after.data.query.attention &&
      !after.data.query.familyId
    ) {
      for (const row of before.data.records) {
        const next = after.data.records.find(
          (n) => n.id === row.id && n.kind === row.kind,
        );
        if (row.shared && !next?.shared) sharedIds.add(row.id);
        if (row.access === "family" && next?.access !== "family")
          familyIds.add(row.id);
      }
    }
  }
  if (sharedIds.size) {
    drop(
      session,
      (p) =>
        p.startsWith(base + "/shared?") || p.startsWith(base + "/overview"),
      path,
    );
    emit({
      scope: "records",
      tripId,
      projection: "shared",
      recordIds: [...sharedIds],
    });
  }
  if (familyIds.size) {
    redactFamilyRecords(session, base, familyIds, path);
    emit({
      scope: "records",
      tripId,
      projection: "family",
      recordIds: [...familyIds],
    });
  }
}
const toResponse = (reply: JsonReply) =>
  new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: reply.headers,
  });
function abortable<T>(
  work: Promise<T>,
  signal?: AbortSignal | null,
): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const aborted = () =>
      reject(
        new TripError(
          "This request was cancelled.",
          0,
          undefined,
          "request_cancelled",
        ),
      );
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    void work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", aborted));
  });
}
async function readJson(
  session: Session | null,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  querySignal?: AbortSignal,
): Promise<JsonReply> {
  assertSession(session);
  const controller = new AbortController(),
    abort = () => controller.abort();
  session?.controller.signal.addEventListener("abort", abort, { once: true });
  querySignal?.addEventListener("abort", abort, { once: true });
  if (querySignal?.aborted) controller.abort();
  try {
    return await withinRequest(controller.signal, timeoutMs, async (signal) => {
      const response = await fetch(url, { ...init, signal });
      assertSession(session, signal);
      serviceReachable();
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new TripError(
          "The server returned an unreadable reply. Try again.",
          502,
        );
      }
      assertSession(session, signal);
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const reply = { status: response.status, body, headers };
      if (!response.ok) throw new ServerReplyError(reply);
      return reply;
    });
  } catch (error) {
    assertSession(session, querySignal);
    if (error instanceof RequestDeadlineError)
      throw new TripError(
        "Loading took longer than expected. Try again.",
        0,
        undefined,
        "read_timeout",
      );
    if (error instanceof TripError) throw error;
    throw new TripError(
      "This request could not reach the server. Try again.",
      0,
      undefined,
      "read_unavailable",
    );
  } finally {
    session?.controller.signal.removeEventListener("abort", abort);
    querySignal?.removeEventListener("abort", abort);
  }
}
// Plain fetch handles writes and file authorization. TanStack Query owns the
// in-memory JSON read cache. It never persists JSON or queues a failed save.
export async function travelFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const target = new URL(url),
    path = target.pathname + target.search;
  const method = (init.method ?? "GET").toUpperCase();
  const cleanup =
    (method === "DELETE" && path === "/api/notifications/device") ||
    (path === "/api/me/removal" &&
      new Headers(init.headers).get("Authorization")?.startsWith("Removal "));
  const session = cleanup ? null : currentSession();
  assertSession(session, init.signal ?? undefined);
  const cached =
    !!session &&
    method === "GET" &&
    !/\/me\/removal(?:\?|$)/.test(path) &&
    !/\/checklist\/entries\?requestId=/.test(path);
  try {
    if (!cached) {
      const response = await fetch(url, init);
      assertSession(session, init.signal ?? undefined);
      serviceReachable();
      if (!response.ok && session) {
        try {
          removeDeniedAccess(
            session,
            path,
            new ServerReplyError({
              status: response.status,
              headers: {},
              body: await response.clone().json(),
            }),
            method,
          );
        } catch {
          /* Non-JSON proxy errors establish no permission decision. */
        }
      }
      if (
        response.ok &&
        method !== "GET" &&
        !/\/(open|copy-access|access|summary)$/.test(path)
      )
        void invalidateServerData(path.split("/")[3]);
      return response;
    }
    const client = session?.client ?? fallback,
      key = serverQueryKey(url);
    const previous = client.getQueryData<JsonReply>(key);
    const reply = await abortable(
      client.fetchQuery({
        queryKey: key,
        meta: { path },
        staleTime: serverStaleTime(path),
        queryFn: async ({ signal }) => {
          const next = await readJson(session, url, init, 12_000, signal);
          if (session) reconcileAccess(session, path, next.body, previous);
          return next;
        },
      }),
      init.signal,
    );
    assertSession(session, init.signal ?? undefined);
    return toResponse(reply);
  } catch (error) {
    if (error instanceof ServerReplyError) return toResponse(error.reply);
    assertSession(session, init.signal ?? undefined);
    throw error;
  }
}
