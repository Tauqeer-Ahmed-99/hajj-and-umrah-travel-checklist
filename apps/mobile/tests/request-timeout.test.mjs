import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { test } from "node:test";
import { client } from "./support/client.mjs";
import { createServer } from "node:http";
import { once } from "node:events";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("a stalled first session-token read recovers inside the original Save attempt", async (t) => {
  const { app } = await client(t);
  let tokenCalls = 0,
    writes = 0,
    request,
    renderer;
  app.setTokenProvider(async (options) => {
    tokenCalls++;
    if (tokenCalls === 1) return new Promise(() => {});
    assert.deepEqual(options, { skipCache: true });
    return "fresh-owned-token";
  });
  function Form() {
    request = app.useTripRequest();
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Form));
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let save;
  await act(async () => {
    save = request.run(async (token) => {
      assert.equal(token, "fresh-owned-token");
      writes++;
      return { saved: true };
    });
  });
  for (let second = 0; second < 35; second++)
    await act(async () => {
      t.mock.timers.tick(1_000);
    });
  await act(async () => {
    await save;
  });
  if (!(await save)) {
    const firstError = request.error?.message;
    let retry;
    await act(async () => {
      retry = request.run(async () => {
        writes++;
        return { saved: true };
      });
      await retry;
    });
    t.diagnostic(
      JSON.stringify({
        firstError,
        firstWrites: writes - 1,
        manualSecondTry: await retry,
      }),
    );
  }
  assert.deepEqual(await save, { saved: true });
  assert.equal(request.error, null);
  assert.equal(writes, 1);
  assert.equal(tokenCalls, 2);
});

for (const scenario of [
  "committed",
  "late-committing",
  "account-changed",
  "confirmation-stalled",
  "confirmation-revoked",
])
  test(`a stalled save handles the ${scenario} outcome without another write`, async (t) => {
    const lateCommit = scenario === "late-committing";
    let posts = 0,
      checks = 0,
      request,
      renderer;
    const scope = {
      tripId: "11111111-1111-4111-8111-111111111111",
      familyId: "22222222-2222-4222-8222-222222222222",
    };
    const body = {
      requestId: "33333333-3333-4333-8333-333333333333",
      categoryId: "44444444-4444-4444-8444-444444444444",
      kind: "task",
      title: "Check passport",
      beneficiaries: { kind: "family" },
      responsibleMemberId: "55555555-5555-4555-8555-555555555555",
    };
    const { requestId, ...entryFields } = body;
    const entry = {
      ...entryFields,
      id: "66666666-6666-4666-8666-666666666666",
      familyId: scope.familyId,
      requiredQuantity: null,
      unit: "",
      priority: "normal",
      dueDate: null,
      notes: "",
      leg: "outbound",
      source: "",
      lastReviewedOn: null,
      taskStatus: "to_do",
      acquisition: null,
    };
    const server = createServer(async (req, res) => {
      for await (const _ of req) {
      }
      if (req.method !== "GET") {
        posts++;
        if (posts === 1) return; // Save committed; the original connection never replies.
      } else {
        checks++;
        if (scenario.startsWith("confirmation-") && checks === 1) return;
        if (scenario === "confirmation-revoked") {
          res.writeHead(403, { "Content-Type": "application/json" }).end(
            JSON.stringify({
              error: {
                code: "family_forbidden",
                message: "Your family access changed.",
              },
            }),
          );
          return;
        }
      }
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({ entry: lateCommit && checks === 1 ? null : entry }),
        );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const { app } = await client(
      t,
      `http://127.0.0.1:${server.address().port}`,
    );
    function Form() {
      request = app.useTripRequest();
      return null;
    }
    await act(async () => {
      renderer = create(React.createElement(Form));
    });
    t.after(async () => {
      await act(async () => renderer.unmount());
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let save;
    await act(async () => {
      save = request.run((token, signal) =>
        scenario.startsWith("confirmation-")
          ? app.checklistApi.edit(
              scope,
              entry.id,
              { requestId, taskStatus: "done" },
              token,
              signal,
            )
          : app.checklistApi.create(scope, body, token, signal),
      );
    });
    for (let i = 0; i < 200 && posts === 0; i++)
      await new Promise(setImmediate);
    assert.equal(posts, 1);
    if (scenario === "account-changed") {
      const owner = new AbortController();
      const stop = app.startServerData({
        current: () => owner,
        clearAccount: () => owner.abort(),
      });
      t.after(stop);
    }
    for (let second = 0; second < 35; second++) {
      await act(async () => {
        t.mock.timers.tick(1_000);
        for (let i = 0; i < 5; i++) await new Promise(setImmediate);
      });
    }
    const result = await save;
    t.diagnostic(
      JSON.stringify({ error: request.error?.message, posts, checks }),
    );
    if (scenario === "confirmation-revoked") {
      assert.equal(result, undefined);
      assert.equal(request.error?.status, 403);
    } else if (scenario === "account-changed") {
      assert.equal(result, undefined);
      assert.equal(request.error?.code, "request_cancelled");
    } else {
      assert.equal(result?.entry.id, entry.id);
      assert.equal(request.error, null);
    }
    assert.equal(posts, 1);
    assert.equal(
      checks,
      scenario === "account-changed"
        ? 0
        : lateCommit || scenario.startsWith("confirmation-")
          ? 2
          : 1,
    );
  });

test("a failed token refresh releases Save without sending a mutation", async (t) => {
  const { app } = await client(t);
  let tokenCalls = 0,
    writes = 0,
    request,
    renderer;
  app.setTokenProvider(async () => {
    tokenCalls++;
    return new Promise(() => {});
  });
  function Form() {
    request = app.useTripRequest();
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Form));
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let save;
  await act(async () => {
    save = request.run(async () => {
      writes++;
      return { saved: true };
    });
  });
  for (let second = 0; second < 15; second++)
    await act(async () => {
      t.mock.timers.tick(1_000);
    });
  assert.equal(await save, undefined);
  assert.equal(request.busy, false);
  assert.equal(request.error?.code, "session_refresh_failed");
  assert.equal(tokenCalls, 2);
  assert.equal(writes, 0);
});

for (const changed of ["unmount", "account"])
  test(`a ${changed} during token refresh cannot send the old form's save`, async (t) => {
    const { app } = await client(t);
    let finish,
      writes = 0,
      calls = 0,
      request,
      renderer;
    app.setTokenProvider(async () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    function Form() {
      request = app.useTripRequest();
      return null;
    }
    await act(async () => {
      renderer = create(React.createElement(Form));
    });
    t.after(async () => {
      if (renderer) await act(async () => renderer.unmount());
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let save;
    await act(async () => {
      save = request.run(async () => {
        writes++;
        return { saved: true };
      });
    });
    await act(async () => {
      if (changed === "unmount") {
        renderer.unmount();
        renderer = null;
      } else {
        app.setAuthIdentity("another-user", "another-session");
        renderer.update(React.createElement(Form));
      }
    });
    await act(async () => {
      finish("late-old-account-token");
      await save;
    });
    assert.equal(await save, undefined);
    assert.equal(writes, 0);
    assert.equal(calls, 1);
  });
