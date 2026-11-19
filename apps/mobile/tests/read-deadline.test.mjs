import assert from "node:assert/strict";
import { test } from "node:test";
import { client } from "./support/client.mjs";

test("a native read that ignores abort still reaches its deadline and releases callers", async (t) => {
  const { app } = await client(t);
  let attempts = 0,
    failure;
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    return new Promise(() => {});
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  void app.travelFetch("https://example.test/api/trips", {}).catch((error) => {
    failure = error;
  });
  for (let i = 0; i < 26; i++) {
    t.mock.timers.tick(1000);
    for (let j = 0; j < 10; j++) await Promise.resolve();
  }
  t.diagnostic(JSON.stringify({ attempts, settled: !!failure }));
  assert.equal(failure?.code, "read_timeout");
  assert.equal(
    attempts,
    2,
    "Only the read is retried once; there is no mutation replay.",
  );
});
