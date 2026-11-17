import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { act } from "react-test-renderer";
import React from "react";
import { renderFamily } from "./support/family-render.mjs";
const tripId = "11111111-1111-4111-8111-111111111111",
  familyId = "22222222-2222-4222-8222-222222222222";
const family = {
  id: familyId,
  tripId,
  name: "Owned family",
  role: "coordinator",
  canEdit: true,
  canCoordinate: true,
};
const detail = {
  trip: {
    id: tripId,
    name: "Owned journey",
    kind: "umrah",
    startDate: "2026-11-20",
    endDate: "2026-12-04",
    destinations: ["Makkah"],
    role: "organizer",
  },
  families: [family],
};
const props = {
  tripId,
  familyId,
  onBack() {},
  onAdd() {},
  onAccount() {},
  onAccess() {},
  onChecklist() {},
  onBags() {},
};
async function fixture(t) {
  let hold = false,
    status = 200,
    travelers = [];
  const pending = [];
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const send = () => {
      const roster = req.url.endsWith("/travelers");
      const code = roster ? status : 200;
      res.writeHead(code, { "Content-Type": "application/json" }).end(
        JSON.stringify(
          code === 200
            ? roster
              ? { travelers }
              : detail
            : {
                error: {
                  code: code === 403 ? "family_forbidden" : "unavailable",
                  message:
                    code === 403
                      ? "Family access removed"
                      : "Service unavailable",
                },
              },
        ),
      );
    };
    if (hold) pending.push(send);
    else send();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await act(async () => {
      for (const send of pending.splice(0)) send();
      server.closeAllConnections();
      server.close();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    hold() {
      hold = true;
    },
    release() {
      hold = false;
      for (const send of pending.splice(0)) send();
    },
    status(code) {
      status = code;
    },
    travelers(value) {
      travelers = value;
    },
    count() {
      return requests;
    },
  };
}
const refreshButton = (page) =>
  page.renderer.root
    .findAllByType("button")
    .find((b) => b.props.label === "Refresh family");
test("a foreground family refresh retains content instead of replacing it with skeletons", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  server.hold();
  await page.act(async () => page.app.foreground());
  assert.ok(page.text().includes("Owned family"));
  assert.equal(page.renderer.root.findAllByType("skeleton").length, 0);
  server.release();
});
test("background events do not refresh an inactive tab, and focusing it resumes the current read", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  const count = server.count();
  await page.act(async () => {
    page.app.setFocused(false);
  });
  await page.act(async () => {
    page.app.foreground();
    await new Promise((resolve) => setTimeout(resolve, 15));
  });
  assert.equal(server.count(), count);
  await page.act(async () => page.app.setFocused(true));
  await page.until(() => server.count() === count + 2);
  assert.ok(page.text().includes("Owned family"));
});
test("changing a read scope cancels the old read and cannot publish another leg's data", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  let outboundReads = 0,
    returning = false,
    finishReturn;
  const scopes = createServer((req, res) => {
    const send = (value) => {
      if (!res.destroyed)
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ value }));
    };
    if (req.url === "/outbound") {
      outboundReads++;
      if (outboundReads === 1) send("outbound-record");
    } else {
      returning = true;
      finishReturn = () => send("return-record");
    }
  });
  scopes.listen(0, "127.0.0.1");
  await once(scopes, "listening");
  t.after(() => {
    scopes.closeAllConnections();
    scopes.close();
  });
  const origin = `http://127.0.0.1:${scopes.address().port}`;
  function Probe({ scope }) {
    const api = page.app.useTripRequest(2000, scope),
      [value, setValue] = React.useState(null);
    const read = React.useCallback(async () => {
      const result = await api.run(async (token, signal) => {
        const response = await fetch(origin + "/" + scope, {
          signal,
          headers: { Authorization: `Bearer ${token}` },
        });
        return (await response.json()).value;
      });
      if (result) setValue(result);
    }, [api.run, scope]);
    React.useEffect(() => setValue(null), [scope]);
    page.app.useForegroundRefresh(read);
    return React.createElement(
      "result",
      null,
      value ?? "empty",
      api.error?.message ?? "",
    );
  }
  await page.act(async () =>
    page.renderer.update(React.createElement(Probe, { scope: "outbound" })),
  );
  await page.until(() => page.text().includes("outbound-record"));
  await page.act(async () => page.app.foreground());
  await page.until(() => outboundReads === 2);
  await page.act(async () =>
    page.renderer.update(React.createElement(Probe, { scope: "return" })),
  );
  await page.until(() => returning);
  assert.ok(!page.text().includes("outbound-record"));
  await page.act(async () => {
    finishReturn();
  });
  await page.until(() => page.text().includes("return-record"));
  assert.ok(!page.text().includes("outbound-record"));
});
test("an automatic refresh does not spin or remove the manual refresh control", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  server.hold();
  await page.act(async () => page.app.foreground());
  assert.ok(refreshButton(page));
  assert.ok(!refreshButton(page).props.busy);
  server.release();
});
test("a reconnect cache check and the open family page finish without replacing each other's reads", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  const count = server.count();
  server.hold();
  await page.act(async () => page.app.foreground());
  await page.until(() => server.count() >= count + 2);
  let checking = false;
  const background = page.app.refreshTripCache(
    server.origin,
    async () => {
      checking = true;
      return "owned-test-token";
    },
    new AbortController().signal,
  );
  await page.until(() => checking);
  await page.act(async () => {
    server.release();
    await background;
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  assert.ok(page.text().includes("Owned family"));
  assert.ok(
    !page.text().includes("newer refresh"),
    "the account cache refresh replaced the visible page's read",
  );
  assert.equal(page.renderer.root.findAllByType("skeleton").length, 0);
});
test("a manual refresh joins the active read and settles when the actual HTTP work finishes", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  server.hold();
  await page.act(async () => page.app.foreground());
  let finished = false;
  const request = refreshButton(page)
    .props.onPress()
    .then(() => {
      finished = true;
    });
  await page.act(async () => {
    await new Promise(setImmediate);
  });
  assert.equal(finished, false);
  await page.act(async () => {
    server.release();
    await request;
  });
  assert.equal(finished, true);
});
test("transient refresh failure retains the family and a later refresh shows newly accepted data", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  server.status(503);
  await page.act(async () => {
    await refreshButton(page).props.onPress();
  });
  assert.ok(page.text().includes("Owned family"));
  assert.ok(page.text().includes("Service unavailable"));
  assert.equal(page.renderer.root.findAllByType("skeleton").length, 0);
  server.status(200);
  server.travelers([
    {
      id: "33333333-3333-4333-8333-333333333333",
      familyId,
      firstName: "Owned",
      lastName: "Traveler",
    },
  ]);
  await page.act(async () => {
    await refreshButton(page).props.onPress();
  });
  assert.ok(page.text().includes("1 person in this family"));
  assert.ok(!page.text().includes("Service unavailable"));
});
test("definitive family denial removes previously visible private family data", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  server.status(403);
  await page.act(async () => {
    await refreshButton(page).props.onPress();
  });
  assert.ok(!page.text().includes("Owned family"));
  assert.ok(page.text().includes("Family access removed"));
});
