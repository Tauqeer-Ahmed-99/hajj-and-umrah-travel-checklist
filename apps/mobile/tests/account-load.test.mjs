import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { renderAccount } from "./support/account-render.mjs";

for (const stalledResponse of [false, true])
  test(`opening the account recovers a stalled token${stalledResponse ? " and HTTP response" : ""} before showing the profile-error screen`, async (t) => {
    let reads = 0,
      calls = 0;
    const server = createServer((_req, res) => {
      reads++;
      if (stalledResponse && reads === 1) return;
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          email: "owned@example.test",
          profile: {
            id: "11111111-1111-4111-8111-111111111111",
            firstName: "Test",
            lastName: "Member",
            username: "owned_member",
          },
        }),
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { renderer, act } = await renderAccount(
      t,
      `http://127.0.0.1:${server.address().port}`,
      async (options) => {
        calls++;
        if (calls === 1) return new Promise(() => {});
        assert.deepEqual(options, { skipCache: true });
        return "fresh-token";
      },
    );
    for (let i = 0; i < 35; i++)
      await act(async () => {
        t.mock.timers.tick(1000);
        for (let j = 0; j < 5; j++) await new Promise(setImmediate);
      });
    const openedInitially =
      renderer.root.findAllByType("workspace").length === 1;
    if (!openedInitially)
      t.diagnostic(
        JSON.stringify({
          failure: renderer.root.findByType("recovery").props.failure,
          reads,
          calls,
        }),
      );
    assert.equal(
      openedInitially,
      true,
      "The first account load should recover without manual Try again.",
    );
    assert.equal(reads, stalledResponse ? 2 : 1);
    assert.equal(calls, 2);
  });

test("an unavailable token provider shows sign-in recovery without blaming the profile server", async (t) => {
  let calls = 0,
    reads = 0;
  const server = createServer((_req, res) => {
    reads++;
    res.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { renderer, act } = await renderAccount(
    t,
    `http://127.0.0.1:${server.address().port}`,
    async () => {
      calls++;
      return new Promise(() => {});
    },
  );
  for (let i = 0; i < 15; i++)
    await act(async () => {
      t.mock.timers.tick(1000);
    });
  const recovery = renderer.root.findByType("recovery");
  assert.equal(recovery.props.failure, "session");
  assert.equal(recovery.props.loading, false);
  assert.equal(calls, 2);
  assert.equal(reads, 0);
});
