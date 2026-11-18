import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { client } from "./support/client.mjs";
const trip = "11111111-1111-4111-8111-111111111111",
  family = "22222222-2222-4222-8222-222222222222";
const path = `/api/trips/${trip}/families/${family}/travelers`;
const json = (res, status, body) =>
  res
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify(body));
async function service(t, handle) {
  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("HTTP fixture did not reach the expected state");
}
const stale = (app) =>
  app.getServerQueryClient().invalidateQueries({ refetchType: "none" });

test("concurrent JSON reads share one request, fresh reads use memory, and explicit invalidation obtains new data", async (t) => {
  const { app } = await client(t);
  let count = 0,
    finish;
  const origin = await service(t, (_, res) => {
    count++;
    finish = (value) => json(res, 200, { value });
  });
  const first = app.travelFetch(origin + path, {});
  await until(() => count === 1);
  const second = app.travelFetch(origin + path, {});
  finish("first");
  const [a, b] = await Promise.all([first, second]);
  assert.notEqual(a, b);
  assert.deepEqual(await a.json(), await b.json());
  assert.equal(
    (await (await app.travelFetch(origin + path, {})).json()).value,
    "first",
  );
  assert.equal(count, 1);
  await stale(app);
  const next = app.travelFetch(origin + path, {});
  await until(() => count === 2);
  finish("new");
  assert.equal((await (await next).json()).value, "new");
});

test("a denied family progress query removes that family without revoking the trip or another family", async (t) => {
  const { app } = await client(t),
    events = [];
  const stop = app.onServerAccessRevoked((event) => events.push(event));
  t.after(stop);
  const other = `/api/trips/${trip}/families/33333333-3333-4333-8333-333333333333/checklist`;
  const overview = `/api/trips/${trip}/overview?scope=family&familyId=${family}`;
  const origin = await service(t, (req, res) =>
    req.url === overview
      ? json(res, 404, {
          error: { code: "not_found", message: "Family access removed" },
        })
      : json(res, 200, { private: "authorized" }),
  );
  await app.travelFetch(origin + path, {});
  await app.travelFetch(origin + other, {});
  assert.equal((await app.travelFetch(origin + overview, {})).status, 404);
  assert.deepEqual(
    events.map((e) => ({ scope: e.scope, familyId: e.familyId })),
    [{ scope: "family", familyId: family }],
  );
  assert.equal(
    app.getServerQueryClient().getQueryData(app.serverQueryKey(origin + path)),
    undefined,
  );
  assert.equal(
    app.getServerQueryClient().getQueryData(app.serverQueryKey(origin + other))
      .body.private,
    "authorized",
  );
});
test("a cancelled screen read does not cancel another consumer or label the server offline", async (t) => {
  const { app } = await client(t);
  let finish,
    count = 0;
  const origin = await service(t, (_, res) => {
    count++;
    finish = () => json(res, 200, { value: "owned" });
  });
  const cancelled = new AbortController();
  const first = app.travelFetch(origin + path, { signal: cancelled.signal });
  const rejected = assert.rejects(first);
  await until(() => finish);
  const second = app.travelFetch(origin + path, {});
  cancelled.abort();
  await rejected;
  finish();
  assert.equal((await (await second).json()).value, "owned");
  assert.equal(count, 1);
  assert.equal(app.connectionState().status, "online");
});
test("record freshness expires after 30 seconds while stable travel details remain fresh for two minutes", async (t) => {
  const { app } = await client(t);
  let now = Date.now();
  const original = Date.now;
  Date.now = () => now;
  t.after(() => {
    Date.now = original;
  });
  const calls = [];
  const origin = await service(t, (req, res) => {
    calls.push(req.url);
    json(res, 200, { read: calls.length });
  });
  await app.travelFetch(origin + path, {});
  await app.travelFetch(origin + `/api/trips/${trip}/itinerary`, {});
  now += 29_000;
  await app.travelFetch(origin + path, {});
  assert.equal(calls.length, 2);
  now += 2_000;
  await app.travelFetch(origin + path, {});
  await app.travelFetch(origin + `/api/trips/${trip}/itinerary`, {});
  assert.equal(calls.length, 3);
  now += 90_000;
  await app.travelFetch(origin + `/api/trips/${trip}/itinerary`, {});
  assert.equal(calls.length, 4);
});
test("a transient JSON read failure retains its previous data and never queues or retries a save", async (t) => {
  const { app } = await client(t);
  let failing = false,
    writes = 0;
  const origin = await service(t, (req, res) => {
    if (req.method === "POST") {
      writes++;
      return req.socket.destroy();
    }
    json(
      res,
      failing ? 503 : 200,
      failing
        ? { error: { code: "unavailable", message: "Try again" } }
        : { value: "retained" },
    );
  });
  await app.travelFetch(origin + path, {});
  failing = true;
  await stale(app);
  assert.equal((await app.travelFetch(origin + path, {})).status, 503);
  assert.equal(
    app.getServerQueryClient().getQueryData(app.serverQueryKey(origin + path))
      .body.value,
    "retained",
  );
  await assert.rejects(
    app.travelFetch(origin + path, { method: "POST", body: "{}" }),
  );
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(writes, 1);
  assert.equal(app.connectionState().status, "online");
});
test("a family denial removes that family's data and cancels a held read without deleting another family", async (t) => {
  const { app } = await client(t);
  let denied = false,
    finish;
  const other = path.replace(family, "33333333-3333-4333-8333-333333333333");
  const origin = await service(t, (req, res) => {
    if (req.url === path + "?held=1") {
      finish = () => json(res, 200, { private: "old" });
      return;
    }
    if (req.url === path && denied)
      return json(res, 403, {
        error: { code: "family_forbidden", message: "Family access removed" },
      });
    json(res, 200, { private: req.url === other ? "independent" : "owned" });
  });
  await app.travelFetch(origin + path, {});
  await app.travelFetch(origin + other, {});
  const late = app.travelFetch(origin + path + "?held=1", {});
  const rejected = assert.rejects(late);
  await until(() => finish);
  denied = true;
  await stale(app);
  assert.equal((await app.travelFetch(origin + path, {})).status, 403);
  finish();
  await rejected;
  assert.equal(
    app.getServerQueryClient().getQueryData(app.serverQueryKey(origin + path)),
    undefined,
  );
  assert.equal(
    app.getServerQueryClient().getQueryData(app.serverQueryKey(origin + other))
      .body.private,
    "independent",
  );
});
test("a replacement account cannot receive or cache the previous account's held JSON", async (t) => {
  const { app } = await client(t);
  let finish;
  const origin = await service(t, (_, res) => {
    finish = () => json(res, 200, { private: "previous" });
  });
  const late = app.travelFetch(origin + path, {});
  const rejected = assert.rejects(late);
  await until(() => finish);
  const owner = new AbortController();
  const stop = app.startServerData({
    current: () => owner,
    clearAccount: () => owner.abort(),
  });
  t.after(stop);
  finish();
  await rejected;
  assert.equal(app.getServerQueryClient().getQueryCache().getAll().length, 0);
});
test("an accepted mutation invalidates related JSON reads", async (t) => {
  const { app } = await client(t);
  let count = 0,
    value = "before";
  const origin = await service(t, (req, res) => {
    if (req.method === "POST") {
      value = "after";
      return json(res, 201, { saved: true });
    }
    count++;
    json(res, 200, { value });
  });
  await app.travelFetch(origin + path, {});
  await app.travelFetch(origin + path, { method: "POST", body: "{}" });
  assert.equal(
    (await (await app.travelFetch(origin + path, {})).json()).value,
    "after",
  );
  assert.equal(count, 2);
});

test("refusing an organizer-only action does not revoke the viewer's independent read grant", async (t) => {
  const { app, invalidated } = await client(t);
  const events = [];
  t.after(app.onServerAccessRevoked((event) => events.push(event)));
  const origin = await service(t, (req, res) => {
    if (req.method === "POST" || req.url.endsWith("/invitations"))
      return json(res, 403, {
        error: {
          code: req.method === "POST" ? "family_forbidden" : "trip_forbidden",
          message: "Organizers only",
        },
      });
    json(res, 200, { private: "readable" });
  });
  await app.travelFetch(origin + path, {});
  assert.equal(
    (await app.travelFetch(origin + path, { method: "POST", body: "{}" }))
      .status,
    403,
  );
  assert.equal(
    (await app.travelFetch(origin + `/api/trips/${trip}/invitations`, {}))
      .status,
    403,
  );
  assert.equal(events.length, 0);
  assert.equal(
    app.getServerQueryClient().getQueryData(app.serverQueryKey(origin + path))
      .body.private,
    "readable",
  );
  assert.equal(invalidated(), false);
});

test("a withdrawn family record is removed from cached legs and filters while unrelated records remain", async (t) => {
  const { app } = await client(t);
  const id = "44444444-4444-4444-8444-444444444444",
    kept = "55555555-5555-4555-8555-555555555555";
  let withdrawn = false;
  const record = (id) => ({
    id,
    kind: "task",
    familyId: family,
    familyName: "Family",
    access: "family",
    shared: false,
    assignedToMe: false,
    title: "Task",
    leg: "outbound",
    priority: "normal",
    status: "to_do",
    requiredQuantity: null,
    available: null,
    remainingToPrepare: null,
    remainingToPlace: null,
    unaccounted: null,
    unit: "",
    locations: [],
    confirmedAt: null,
    needsReview: false,
    attention: ["tasks"],
  });
  const overview = () => ({
    query: { scope: "all", leg: "outbound", q: "" },
    asOf: new Date().toISOString(),
    phase: "preparing_at_home",
    nextDeparture: null,
    preparation: {
      activeItems: 0,
      availableItems: 0,
      openTasks: withdrawn ? 1 : 2,
    },
    readiness: {
      verification: "not_verified",
      confirmedBags: 0,
      totalBags: 0,
      unknownOrReviewBags: 0,
    },
    actions: [],
    records: (withdrawn ? [kept] : [id, kept]).map(record),
  });
  const origin = await service(t, (req, res) =>
    json(
      res,
      200,
      req.url.endsWith("/overview")
        ? overview()
        : {
            entries: [
              { id, title: "Withdrawn" },
              { id: kept, title: "Kept" },
            ],
          },
    ),
  );
  const current = origin + `/api/trips/${trip}/overview`,
    familyRead = origin + path.replace("travelers", "checklist"),
    returning = origin + path.replace("travelers", "packing?leg=return");
  await app.travelFetch(current, {});
  await app.travelFetch(familyRead, {});
  await app.travelFetch(returning, {});
  withdrawn = true;
  await stale(app);
  await app.travelFetch(current, {});
  for (const url of [familyRead, returning])
    assert.deepEqual(
      app.getServerQueryClient().getQueryData(app.serverQueryKey(url)).body
        .entries,
      [{ id: kept, title: "Kept" }],
    );
});
test("share-access and guide-version checks always read current authorization", async (t) => {
  const { app } = await client(t);
  let count = 0;
  const origin = await service(t, (_, res) => {
    count++;
    json(res, 200, { read: count });
  });
  const guide = `/api/trips/${trip}/guides/44444444-4444-4444-8444-444444444444`,
    summary = `/api/trips/${trip}/summary`;
  await app.travelFetch(origin + guide, {});
  await app.travelFetch(origin + guide, {});
  await app.travelFetch(origin + summary, {});
  await app.travelFetch(origin + summary, {});
  assert.equal(count, 4);
});
test("withdrawing a shared item invalidates both leg caches and preserves independent family data", async (t) => {
  const { app } = await client(t);
  let withdrawn = false;
  const id = "44444444-4444-4444-8444-444444444444";
  const entry = {
    id,
    familyId: family,
    kind: "task",
    title: "Shared task",
    requiredQuantity: null,
    unit: "",
    beneficiaries: { kind: "family" },
    responsibleMemberId: "55555555-5555-4555-8555-555555555555",
    priority: "normal",
    dueDate: null,
    notes: "",
    leg: "both",
    source: "",
    lastReviewedOn: null,
    taskStatus: "to_do",
    acquisition: null,
  };
  const origin = await service(t, (req, res) =>
    json(
      res,
      200,
      req.url.includes("/shared?")
        ? {
            leg: req.url.endsWith("return") ? "return" : "outbound",
            items: withdrawn
              ? []
              : [
                  {
                    entry,
                    beneficiaryFamilies: [],
                    packing: null,
                    canEdit: true,
                    canShare: false,
                  },
                ],
            bags: [],
            history: [],
          }
        : { private: "family copy" },
    ),
  );
  const outbound = origin + `/api/trips/${trip}/shared?leg=outbound`,
    returning = outbound.replace("outbound", "return");
  let event;
  const stop = app.onServerAccessRevoked((value) => {
    event = value;
  });
  t.after(stop);
  await app.travelFetch(outbound, {});
  await app.travelFetch(returning, {});
  await app.travelFetch(origin + path, {});
  withdrawn = true;
  await stale(app);
  await app.travelFetch(outbound, {});
  assert.equal(
    app.getServerQueryClient().getQueryData(app.serverQueryKey(returning)),
    undefined,
  );
  assert.equal(
    app.getServerQueryClient().getQueryData(app.serverQueryKey(origin + path))
      .body.private,
    "family copy",
  );
  assert.deepEqual(event.recordIds, [id]);
  assert.equal(event.projection, "shared");
});
