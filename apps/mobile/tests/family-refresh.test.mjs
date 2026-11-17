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

test("a stale foreground refresh keeps the family visible while actual HTTP reads finish", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  const count = server.count();
  server.hold();
  await page.act(async () => {
    await page.stale();
    page.app.foreground();
  });
  await page.until(() => server.count() === count + 2);
  assert.ok(page.text().includes("Owned family"));
  assert.equal(page.renderer.root.findAllByType("skeleton").length, 0);
  await page.act(async () => {
    server.release();
    await refreshButton(page).props.onPress();
  });
});
test("fresh family data is reused when a tab is opened again", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  const count = server.count();
  await page.act(async () => page.app.setFocused(false));
  await page.act(async () => page.app.foreground());
  await page.act(async () => page.app.setFocused(true));
  assert.equal(server.count(), count);
  assert.ok(page.text().includes("Owned family"));
});
test("inactive tabs do not refresh stale data until focused", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  const count = server.count();
  await page.act(async () => {
    page.app.setFocused(false);
  });
  await page.act(async () => {
    await page.stale();
    page.app.foreground();
    await new Promise((r) => setTimeout(r, 15));
  });
  assert.equal(server.count(), count);
  await page.act(async () => page.app.setFocused(true));
  await page.until(() => server.count() === count + 2);
  assert.ok(page.text().includes("Owned family"));
});
test("switching travel legs cannot publish a held response into the other leg", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  let holdOutbound = false,
    finishOutbound,
    finishReturn,
    initialSetter;
  const originServer = createServer((req, res) => {
    const send = (value) =>
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ value }));
    if (req.url.endsWith("outbound")) {
      if (holdOutbound) finishOutbound = () => send("old outbound");
      else send("outbound");
    } else finishReturn = () => send("return");
  });
  originServer.listen(0, "127.0.0.1");
  await once(originServer, "listening");
  t.after(() => {
    originServer.closeAllConnections();
    originServer.close();
  });
  const origin = "http://127.0.0.1:" + originServer.address().port;
  function Probe({ leg }) {
    const data = page.app.useServerView(
      "/api/trips/" + tripId + "/families/" + familyId + "/packing",
      ["packing", tripId, familyId, leg],
      async (_token, signal) =>
        (
          await (
            await page.app.travelFetch(
              origin +
                "/api/trips/" +
                tripId +
                "/families/" +
                familyId +
                "/packing?leg=" +
                leg,
              { signal },
            )
          ).json()
        ).value,
    );
    initialSetter ??= data.setData;
    return React.createElement("result", null, data.data ?? "empty");
  }
  await page.act(async () => page.replace(Probe, { leg: "outbound" }));
  await page.until(() => page.text().includes("outbound"));
  holdOutbound = true;
  await page.act(async () => {
    await page.stale();
    page.app.foreground();
  });
  await page.until(() => finishOutbound);
  await page.act(async () => page.replace(Probe, { leg: "return" }));
  await page.until(() => finishReturn);
  assert.ok(!page.text().includes("outbound"));
  await page.act(async () => {
    finishReturn();
    finishOutbound();
  });
  await page.until(() => page.text().includes("return"));
  assert.ok(!page.text().includes("outbound"));
  await page.act(async () => initialSetter("current leg updated"));
  await page.until(() => page.text().includes("current leg updated"));
});
test("automatic reads retain the manual refresh control without its busy state", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  server.hold();
  await page.act(async () => {
    await page.stale();
    page.app.foreground();
  });
  assert.ok(refreshButton(page));
  assert.ok(!refreshButton(page).props.busy);
  await page.act(async () => {
    server.release();
    await refreshButton(page).props.onPress();
  });
});
test("manual refresh joins an active Query read and waits for its HTTP response", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  const count = server.count();
  server.hold();
  await page.act(async () => {
    await page.stale();
    page.app.foreground();
  });
  await page.until(() => server.count() === count + 2);
  let finished = false;
  const read = refreshButton(page)
    .props.onPress()
    .then(() => {
      finished = true;
    });
  await page.act(async () => {
    await new Promise(setImmediate);
  });
  assert.equal(finished, false);
  assert.equal(server.count(), count + 2);
  await page.act(async () => {
    server.release();
    await read;
  });
  assert.equal(finished, true);
});
test("temporary failure leaves family content readable and a later refresh accepts new data", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  server.status(503);
  await page.act(async () => {
    await refreshButton(page).props.onPress();
  });
  await page.until(() => page.text().includes("Service unavailable"));
  assert.ok(page.text().includes("Owned family"));
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
  await page.until(() => page.text().includes("1 person in this family"));
  assert.ok(!page.text().includes("Service unavailable"));
});
test("definitive family denial removes private content, and only an accepted fresh read can restore it", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(() => page.text().includes("Owned family"));
  server.status(403);
  await page.act(async () => {
    await refreshButton(page).props.onPress();
  });
  assert.ok(!page.text().includes("Owned family"));
  assert.ok(page.text().includes("Family access removed"));
  server.status(200);
  await page.act(async () => {
    await refreshButton(page).props.onPress();
  });
  await page.until(() => page.text().includes("Owned family"));
  assert.ok(!page.text().includes("Family access removed"));
});
