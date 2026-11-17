import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { client } from "./support/client.mjs";

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
const json = (response, status, body) =>
  response
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify(body));

test("cancelling a screen read does not label a reachable service offline or block its next write", async (t) => {
  const { app } = await client(t);
  let seen;
  const started = new Promise((resolve) => {
    seen = resolve;
  });
  let writes = 0;
  const origin = await service(t, (req, res) => {
    if (req.url === "/hold") {
      seen();
      return;
    }
    if (req.method === "POST") writes++;
    json(res, 200, {});
  });
  const controller = new AbortController();
  const read = app.travelFetch(origin + "/hold", { signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(read);
  assert.equal(app.connectionState().status, "online");
  assert.equal(
    (await app.travelFetch(origin + "/api/trips", { method: "POST" })).status,
    200,
  );
  assert.equal(writes, 1);
});
test("repeated connected hints do not invalidate confirmed access", async (t) => {
  const { app } = await client(t);
  app.setDeviceNetworkAvailable(true);
  assert.equal(app.connectionState().status, "online");
});
test("cellular transport stays available when Android's validation probe fails or is unknown", async (t) => {
  const { app } = await client(t);
  assert.equal(
    app.transportHint({ isConnected: true, isInternetReachable: false }),
    true,
  );
  assert.equal(app.transportHint({ isConnected: true }), true);
  assert.equal(app.transportHint({ isInternetReachable: false }), null);
  assert.equal(app.transportHint({ isConnected: false }), false);
});
test("an actual HTTP reply recovers from an obsolete disconnected hint", async (t) => {
  const { app } = await client(t);
  const origin = await service(t, (_req, res) => json(res, 200, {}));
  app.setDeviceNetworkAvailable(false);
  assert.equal(app.connectionState().status, "offline");
  await app.travelFetch(origin + "/api/me", {});
  assert.equal(app.connectionState().status, "online");
  await app.travelFetch(origin + "/api/trips", { method: "POST" });
});
test("a background JSON 503 does not disable unrelated online operations", async (t) => {
  const { app } = await client(t);
  const tripId = "11111111-1111-4111-8111-111111111111";
  const path = `/api/trips/${tripId}`;
  const origin = await service(t, (req, res) =>
    json(res, req.url === path ? 503 : 200, {}),
  );
  await app.travelFetch(origin + path, {});
  assert.equal(app.connectionState().status, "online");
  assert.equal(
    (await app.travelFetch(origin + "/api/trips", { method: "POST" })).status,
    200,
  );
});
test("a failed request stays local and a subsequent explicit save attempts the network once", async (t) => {
  const { app } = await client(t);
  let requests = 0;
  const origin = await service(t, (req) => {
    requests++;
    req.socket.destroy();
  });
  await assert.rejects(app.travelFetch(origin + "/api/trips", {}));
  assert.equal(app.connectionState().status, "online");
  await assert.rejects(
    app.travelFetch(origin + "/api/trips", { method: "POST" }),
  );
  assert.equal(requests, 3);
});
test("a confirmed expired session invalidates the private account gate", async (t) => {
  const { app, invalidated } = await client(t);
  const origin = await service(t, (_req, res) =>
    json(res, 401, {
      error: { code: "invalid_session", message: "Sign in again" },
    }),
  );
  assert.equal((await app.travelFetch(origin + "/api/me", {})).status, 401);
  assert.equal(invalidated(), true);
  await assert.rejects(
    app.travelFetch(origin + "/api/trips", { method: "POST" }),
  );
});
