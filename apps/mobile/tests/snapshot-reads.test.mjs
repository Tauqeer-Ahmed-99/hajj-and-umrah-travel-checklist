import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { client } from "./support/client.mjs";

const path = "/api/trips/11111111-1111-4111-8111-111111111111";
const detail = (name = "Owned journey") => ({
  trip: {
    id: path.split("/").at(-1),
    name,
    kind: "umrah",
    startDate: "2026-11-20",
    endDate: "2026-12-04",
    destinations: ["Makkah"],
    role: "organizer",
  },
  families: [],
});
const json = (res, status, data) =>
  res
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify(data));
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
const options = (signal, token = "owned-token") => ({
  signal,
  headers: { Authorization: `Bearer ${token}` },
});
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("HTTP fixture did not reach the expected state");
}

test("overlapping snapshot consumers get independent bodies from one live read, and a later refresh stays fresh", async (t) => {
  const { app } = await client(t);
  let finish,
    count = 0;
  const origin = await service(t, (_req, res) => {
    count++;
    finish = (name) => json(res, 200, detail(name));
  });
  const first = app.travelFetch(origin + path, { method: "GET", ...options() });
  await until(() => count === 1);
  const second = app.travelFetch(origin + path, options());
  finish("First live result");
  const results = await Promise.all([first, second]);
  assert.equal(count, 1);
  assert.notEqual(results[0], results[1]);
  assert.deepEqual(await results[0].json(), await results[1].json());
  const next = app.travelFetch(origin + path, options());
  await until(() => count === 2);
  finish("Newly changed journey");
  assert.equal((await (await next).json()).trip.name, "Newly changed journey");
});

test("cancelling one snapshot consumer keeps another consumer's read alive", async (t) => {
  const { app } = await client(t);
  let finish,
    count = 0;
  const cancelled = new AbortController();
  const origin = await service(t, (_req, res) => {
    count++;
    finish = () => json(res, 200, detail());
  });
  const first = app.travelFetch(origin + path, options(cancelled.signal));
  const rejected = assert.rejects(first);
  await until(() => count === 1);
  const second = app.travelFetch(origin + path, options());
  cancelled.abort();
  await rejected;
  finish();
  assert.equal((await (await second).json()).trip.name, "Owned journey");
  assert.equal(count, 1);
  assert.equal(app.connectionState().status, "online");
});

test("cancelling every consumer releases the transport and the next refresh starts a new read", async (t) => {
  const { app } = await client(t);
  let closed = false,
    count = 0;
  const origin = await service(t, (_req, res) => {
    count++;
    if (count === 1)
      res.on("close", () => {
        closed = true;
      });
    else json(res, 200, detail());
  });
  const controller = new AbortController();
  const read = app.travelFetch(origin + path, options(controller.signal));
  const rejected = assert.rejects(read);
  await until(() => count === 1);
  controller.abort();
  await rejected;
  await until(() => closed);
  assert.equal((await app.travelFetch(origin + path, options())).status, 200);
  assert.equal(count, 2);
  assert.equal(app.connectionState().status, "online");
});

test("different authorization never shares a snapshot, and a newer denial prevents a held success restoring private data", async (t) => {
  const { app } = await client(t);
  let finish,
    hold = false,
    reads = 0;
  const origin = await service(t, (req, res) => {
    reads++;
    if (req.headers.authorization === "Bearer revoked-token")
      return json(res, 403, {
        error: { code: "trip_forbidden", message: "Trip access removed" },
      });
    if (hold) finish = () => json(res, 200, detail());
    else json(res, 200, detail());
  });
  await app.travelFetch(origin + path, options());
  assert.equal(app.listTripSnapshots().length, 1);
  hold = true;
  const late = app.travelFetch(origin + path, options());
  const rejected = assert.rejects(late);
  await until(() => finish);
  const denied = await app.travelFetch(
    origin + path,
    options(undefined, "revoked-token"),
  );
  assert.equal(denied.status, 403);
  finish();
  await rejected;
  assert.equal(reads, 3);
  assert.equal(app.listTripSnapshots().length, 0);
});

test("a replacement account cannot receive or cache an earlier account's held snapshot", async (t) => {
  const { app } = await client(t);
  let finish;
  const origin = await service(t, (_req, res) => {
    finish = () => json(res, 200, detail());
  });
  const late = app.travelFetch(origin + path, options());
  const rejected = assert.rejects(late);
  await until(() => finish);
  const owner = new AbortController();
  const stop = app.startTripCache({
    directory: new app.Directory("memory://replacement-account"),
    current: () => owner,
    completed: () => true,
    clearAccount: () => owner.abort(),
  });
  t.after(stop);
  finish();
  await rejected;
  assert.equal(app.listTripSnapshots().length, 0);
});
