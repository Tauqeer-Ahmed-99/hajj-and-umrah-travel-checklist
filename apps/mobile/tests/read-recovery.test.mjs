import assert from "node:assert/strict";
import React from "react";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { renderFamily } from "./support/family-render.mjs";

const path =
  "/api/trips/11111111-1111-4111-8111-111111111111/families/22222222-2222-4222-8222-222222222222/packing";
async function fixture(t, provider) {
  let status = 200,
    value = "loaded bags",
    reads = 0,
    hold = false;
  const pending = [];
  const server = createServer((_req, res) => {
    reads++;
    const send = () =>
      res.writeHead(status, { "Content-Type": "application/json" }).end(
        JSON.stringify(
          status === 200
            ? { value }
            : {
                error: {
                  code: "unavailable",
                  message:
                    "The server took too long to reply. Your details are still here. Try again.",
                },
              },
        ),
      );
    if (hold) pending.push(send);
    else send();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let state;
  const page = await renderFamily(t, origin, {}, (app) => {
    if (provider) app.setTokenProvider(provider);
    return function Probe() {
      state = app.useServerView(path, ["packing"], async (token, signal) => {
        const response = await app.travelFetch(origin + path, {
          signal,
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await response.json();
        if (!response.ok)
          throw new (class extends Error {
            status = response.status;
          })(body.error.message);
        return body;
      });
      return React.createElement("result", null, state.data?.value ?? "empty");
    };
  });
  return {
    ...page,
    state: () => state,
    reads: () => reads,
    fail: () => (status = 503),
    recover: () => {
      status = 200;
      value = "updated bags";
      hold = false;
      for (const send of pending.splice(0)) send();
    },
    hold: () => (hold = true),
  };
}

test("the common screen reader refreshes a stuck cached token during the first load", async (t) => {
  let calls = 0;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = await fixture(t, async (options) => {
    calls++;
    if (!options?.skipCache) return new Promise(() => {});
    return "fresh-token";
  });
  for (let i = 0; i < 15; i++)
    await page.act(async () => {
      t.mock.timers.tick(1000);
      for (let j = 0; j < 6; j++) await new Promise(setImmediate);
    });
  t.diagnostic(
    JSON.stringify({
      reads: page.reads(),
      error: page.state().error?.message,
      calls,
    }),
  );
  assert.equal(page.state().data?.value, "loaded bags");
  assert.equal(page.state().error, null);
  assert.equal(calls, 2);
});

test("a failed background read keeps loaded content and reports refresh failure separately", async (t) => {
  const page = await fixture(t);
  await page.until(() => page.state().data?.value === "loaded bags");
  page.fail();
  await page.act(async () => {
    await page.state().refresh();
  });
  await page.until(
    () =>
      !page.state().busy && (page.state().error || page.state().refreshError),
  );
  assert.equal(page.state().data?.value, "loaded bags");
  assert.equal(
    page.state().error,
    null,
    "A failed refresh must not become an initial-load error over usable content.",
  );
  assert.ok(page.state().refreshError);
  page.hold();
  let refresh;
  await page.act(async () => {
    refresh = page.state().refresh();
    await new Promise(setImmediate);
  });
  assert.equal(page.state().error, null);
  assert.equal(
    page.state().refreshError,
    null,
    "The previous failure must clear while an explicit retry is running.",
  );
  await page.act(async () => {
    page.recover();
    await refresh;
  });
  assert.equal(page.state().data.value, "updated bags");
});
