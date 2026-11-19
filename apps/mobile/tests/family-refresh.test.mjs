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
const overview = {
  query: { scope: "family", familyId, leg: "outbound", q: "" },
  asOf: "2026-11-18T12:00:00.000Z",
  phase: "planning",
  nextDeparture: null,
  preparation: { activeItems: 0, availableItems: 0, openTasks: 0 },
  readiness: {
    verification: "not_verified",
    confirmedBags: 0,
    totalBags: 0,
    unknownOrReviewBags: 0,
  },
  actions: [],
  records: [],
};
async function fixture(t) {
  let hold = false,
    status = 200,
    travelers = [];
  let progress = structuredClone(overview);
  const pending = [];
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    const send = () => {
      if (req.url.includes("/overview")) {
        assert.equal(
          new URL(req.url, "http://localhost").searchParams.get("familyId"),
          familyId,
        );
        assert.equal(
          new URL(req.url, "http://localhost").searchParams.get("scope"),
          "family",
        );
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify(progress));
        return;
      }
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
    progress(records) {
      progress = { ...progress, records };
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

function record(index, patch = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    kind: "item",
    familyId,
    familyName: "Owned family",
    access: "family",
    shared: false,
    assignedToMe: false,
    title: `Preparation ${index}`,
    leg: "outbound",
    priority: "normal",
    status: "Still needed",
    requiredQuantity: 1,
    available: 0,
    remainingToPrepare: 1,
    remainingToPlace: 1,
    unaccounted: null,
    unit: "pieces",
    locations: [],
    confirmedAt: null,
    needsReview: false,
    attention: ["preparation"],
    ...patch,
  };
}
test("family progress counts ready items and completed tasks separately and keeps those counts during refresh", async (t) => {
  const server = await fixture(t);
  const records = [
    record(1, { available: 1, remainingToPrepare: 0 }),
    record(2),
    record(3, { requiredQuantity: 0 }),
    record(4, { kind: "task", status: "Done", attention: [] }),
    record(5, { kind: "task", status: "In progress", attention: ["tasks"] }),
    record(6, { kind: "task", status: "Not needed", attention: [] }),
  ];
  server.progress(records);
  const page = await renderFamily(t, server.origin, props);
  const values = () =>
    page.renderer.root.findAllByType("metric").map((m) => m.props.value);
  await page.until(() => values().length === 2);
  assert.deepEqual(values(), ["1/2", "1/2"]);
  assert.ok(page.text().includes("1 item still needed"));
  assert.ok(page.text().includes("1 task pending"));
  server.hold();
  let refresh;
  await page.act(async () => {
    refresh = refreshButton(page).props.onPress();
    await new Promise(setImmediate);
  });
  assert.deepEqual(values(), ["1/2", "1/2"]);
  assert.equal(page.renderer.root.findAllByType("skeleton").length, 0);
  server.progress(
    records.map((r) =>
      r.id === records[1].id
        ? { ...r, available: 1, remainingToPrepare: 0 }
        : r,
    ),
  );
  await page.act(async () => {
    server.release();
    await refresh;
  });
  await page.until(() => values()[0] === "2/2");
  assert.deepEqual(values(), ["2/2", "1/2"]);
});

test("family editing is in the heading menu and opens the existing family's prefilled form", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
  const menu = page.renderer.root
    .findAllByType("menu")
    .find((m) => m.props.title === "Family options");
  assert.ok(menu);
  const edit = menu.props.actions.find(
    (action) => action.label === "Edit family",
  );
  assert.ok(edit, "A coordinator must see Edit family inside Family options.");
  assert.ok(
    menu.props.actions.some((action) => action.label === "Members & access"),
  );
  assert.equal(
    page.renderer.root
      .findAllByType("button")
      .some((b) => b.props.title === "Edit family"),
    false,
  );
  await page.act(async () => edit.onPress());
  const form = page.renderer.root.findByType("family-form");
  assert.equal(form.props.initial.id, familyId);
  assert.equal(form.props.initial.name, "Owned family");
  await page.act(async () => form.props.onCancel());
  assert.ok(page.text().includes("Owned family"));
});

test("a stale foreground refresh keeps the family visible while actual HTTP reads finish", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
  const count = server.count();
  server.hold();
  await page.act(async () => {
    await page.stale();
    page.app.foreground();
  });
  await page.until(() => server.count() === count + 3);
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
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
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
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
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
  await page.until(() => server.count() === count + 3);
  assert.ok(page.text().includes("Owned family"));
});
test("switching travel legs cannot publish a held response into the other leg", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
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
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
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
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
  const count = server.count();
  server.hold();
  await page.act(async () => {
    await page.stale();
    page.app.foreground();
  });
  await page.until(() => server.count() === count + 3);
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
  assert.equal(server.count(), count + 3);
  await page.act(async () => {
    server.release();
    await read;
  });
  assert.equal(finished, true);
});
test("temporary failure leaves family content readable and a later refresh accepts new data", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
  server.status(503);
  await page.act(async () => {
    await refreshButton(page).props.onPress();
  });
  await page.until(() =>
    page.text().includes("Showing your last loaded details"),
  );
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
  assert.ok(!page.text().includes("Showing your last loaded details"));
});
test("definitive family denial removes private content, and only an accepted fresh read can restore it", async (t) => {
  const server = await fixture(t),
    page = await renderFamily(t, server.origin, props);
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
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
  await page.until(
    () =>
      page.text().includes("Owned family") &&
      page.renderer.root.findAllByType("metric").length === 2,
  );
  assert.ok(!page.text().includes("Family access removed"));
});
