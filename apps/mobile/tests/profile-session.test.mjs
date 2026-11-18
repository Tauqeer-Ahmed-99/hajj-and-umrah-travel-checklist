import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import {
  profileClient,
  startProfileSession,
} from "./support/profile-client.mjs";

test("a fresh account can save its username after clearing empty file copies", async (t) => {
  let profile = null,
    writes = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "PUT") {
      let body = "";
      for await (const chunk of request) body += chunk;
      profile = {
        id: "11111111-1111-4111-8111-111111111111",
        ...JSON.parse(body),
      };
      writes++;
    }
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ profile, email: "owned@example.com" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const app = await profileClient(
    t,
    `http://127.0.0.1:${server.address().port}`,
  );
  const { copies, client, stop } = startProfileSession(
    t,
    app,
    "owned-new-account",
  );
  const result = await app.accountRequest(
    "owned-token",
    new AbortController().signal,
  );
  assert.equal(result.profile, null);
  // AccountScreen clears managed copies when the server has no saved profile.
  app.clearSessionGuideCopies(copies);
  const saved = await app.accountRequest(
    "owned-token",
    new AbortController().signal,
    { firstName: "Test", lastName: "Member", username: "test_member" },
  );
  assert.equal(writes, 1, "The username save must reach the server.");
  assert.equal(saved.profile.username, "test_member");
  const restored = await app.accountRequest(
    "owned-token",
    new AbortController().signal,
  );
  assert.equal(
    restored.profile.id,
    saved.profile.id,
    "The old empty profile must not survive in the JSON cache.",
  );
  stop();
  assert.notEqual(
    app.getServerQueryClient(),
    client,
    "Stopping the account closes its renewed cache generation too.",
  );
});

test("clearing copies fences out an earlier read and permits a fresh request without replaying it", async (t) => {
  let release,
    count = 0;
  const server = createServer((_request, response) => {
    count++;
    if (count === 1)
      release = () =>
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ value: "old" }));
    else
      response
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ value: "fresh" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const app = await profileClient(t, origin);
  const { copies } = startProfileSession(t, app, "owned-account");
  const previous = app.travelFetch(origin + "/api/trips", {});
  const rejected = assert.rejects(previous);
  for (let i = 0; !release && i < 100; i++)
    await new Promise((done) => setTimeout(done, 5));
  assert.ok(release);
  app.clearSessionGuideCopies(copies);
  const fresh = await app.travelFetch(origin + "/api/trips", {});
  release();
  await rejected;
  assert.equal((await fresh.json()).value, "fresh");
  assert.equal(count, 2);
  assert.equal(
    (await (await app.travelFetch(origin + "/api/trips", {})).json()).value,
    "fresh",
  );
  assert.equal(count, 2, "A cancelled read is never replayed.");
});

test("an expired login cannot reopen requests when private-file cleanup rotates its controller", async (t) => {
  let count = 0;
  const server = createServer((_request, response) => {
    count++;
    response.writeHead(401, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        error: { code: "invalid_session", message: "Sign in again." },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const app = await profileClient(t, origin);
  const { copies } = startProfileSession(t, app, "expired-account");
  await assert.rejects(
    app.accountRequest("expired-token", new AbortController().signal),
    (error) => error.status === 401,
  );
  assert.equal(
    copies.controller.signal.aborted,
    false,
    "The file controller rotates after successful cleanup.",
  );
  await assert.rejects(
    app.accountRequest("expired-token", new AbortController().signal, {
      firstName: "Test",
      lastName: "Member",
      username: "test_member",
    }),
  );
  assert.equal(count, 1, "A revoked login must not send a new write.");
});
