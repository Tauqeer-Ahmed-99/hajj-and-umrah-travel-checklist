import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { client } from "./support/client.mjs";

const scope = {
  tripId: "11111111-1111-4111-8111-111111111111",
  familyId: "22222222-2222-4222-8222-222222222222",
};
const body = {
  requestId: "33333333-3333-4333-8333-333333333333",
  categoryId: "44444444-4444-4444-8444-444444444444",
  kind: "task",
  title: "Check passport",
  requiredQuantity: null,
  unit: "",
  beneficiaries: { kind: "family" },
  responsibleMemberId: "55555555-5555-4555-8555-555555555555",
  priority: "normal",
  dueDate: null,
  notes: "",
  leg: "outbound",
  source: "",
  lastReviewedOn: null,
  taskStatus: "to_do",
};
const { requestId, ...fields } = body;
const entry = {
  ...fields,
  id: "66666666-6666-4666-8666-666666666666",
  familyId: scope.familyId,
  acquisition: null,
};

async function fixture(t, outcome) {
  let posts = 0,
    checks = 0;
  let finish;
  const server = createServer(async (req, res) => {
    if (req.method === "POST") {
      posts++;
      for await (const _ of req) {
      }
      if (outcome === "rejected") {
        res.writeHead(422, { "Content-Type": "application/json" }).end(
          JSON.stringify({
            error: {
              code: "invalid_checklist",
              message: "Choose a category",
            },
          }),
        );
      } else if (outcome === "held") {
        finish = () => req.socket.destroy();
      } else req.socket.destroy(); // Commit succeeded, but its reply was lost.
    } else {
      checks++;
      assert.equal(
        new URL(req.url, "http://localhost").searchParams.get("requestId"),
        requestId,
      );
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ entry: outcome === "saved" ? entry : null }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { app } = await client(t, `http://127.0.0.1:${server.address().port}`);
  return {
    app,
    counts: () => ({ posts, checks }),
    finish: () => finish?.(),
    ready: () => !!finish,
  };
}
test("an item save with a lost reply confirms the committed result through a read without replaying the write", async (t) => {
  const f = await fixture(t, "saved");
  const result = await f.app.checklistApi.create(
    scope,
    body,
    "token",
    new AbortController().signal,
  );
  assert.equal(result.entry.id, entry.id);
  assert.deepEqual(f.counts(), { posts: 1, checks: 1 });
});
test("an unconfirmed save retains its error and never submits a second write", async (t) => {
  const f = await fixture(t, "missing");
  await assert.rejects(
    f.app.checklistApi.create(
      scope,
      body,
      "token",
      new AbortController().signal,
    ),
  );
  assert.deepEqual(f.counts(), { posts: 1, checks: 1 });
});
test("a rejected save does not run an uncertainty check", async (t) => {
  const f = await fixture(t, "rejected");
  await assert.rejects(
    f.app.checklistApi.create(
      scope,
      body,
      "token",
      new AbortController().signal,
    ),
    (e) => e.status === 422,
  );
  assert.deepEqual(f.counts(), { posts: 1, checks: 0 });
});

test("a lost reply after an account switch cannot check the previous account's save in the new cache", async (t) => {
  const f = await fixture(t, "held");
  const save = f.app.checklistApi.create(
    scope,
    body,
    "old-token",
    new AbortController().signal,
  );
  const rejected = assert.rejects(save, (e) => e.code === "request_cancelled");
  for (let i = 0; i < 100 && !f.ready(); i++)
    await new Promise((r) => setTimeout(r, 5));
  assert.ok(f.ready());
  const owner = new AbortController();
  const stop = f.app.startServerData({
    current: () => owner,
    clearAccount: () => owner.abort(),
  });
  t.after(stop);
  f.finish();
  await rejected;
  assert.deepEqual(f.counts(), { posts: 1, checks: 0 });
});
