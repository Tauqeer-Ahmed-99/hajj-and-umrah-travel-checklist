import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";
import { overviewResponse, overviewActivityResponse } from "@nmt/contracts";

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(
  async () => {
    fixture = await startFixture();
  },
  { timeout: 120_000 },
);
after(async () => {
  if (fixture) await fixture.close();
});
async function member(username: string) {
  const token = await fixture.token(
    `user_${username}`,
    `${username}@example.test`,
  );
  const r = await fixture.request("/api/me", token, {
    firstName: "Sana",
    lastName: "Ahmed",
    username,
  });
  assert.equal(r.status, 200, fixture.logs());
  return { token, id: r.data.profile.id as string, username };
}
async function setup(name: string) {
  const owner = await member(`${name}_owner`);
  const r = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Overview journey",
      kind: "umrah",
      startDate: "2090-01-02",
      endDate: "2090-01-15",
      destinations: ["Makkah"],
      familyName: "Ahmed family",
    },
    "POST",
  );
  assert.equal(r.status, 201, fixture.logs());
  const trip = `/api/trips/${r.data.trip.id}`;
  const familyId = r.data.families[0].id as string;
  const family = `${trip}/families/${familyId}`;
  const cat = await fixture.request(
    `${family}/checklist/categories`,
    owner.token,
    { name: "Preparation" },
    "POST",
  );
  return {
    owner,
    trip,
    family,
    familyId,
    categoryId: cat.data.category.id as string,
  };
}
type Journey = Awaited<ReturnType<typeof setup>>;
async function entry(j: Journey, title: string, fields: object = {}) {
  const r = await fixture.request(
    `${j.family}/checklist/entries`,
    j.owner.token,
    {
      kind: "item",
      title,
      categoryId: j.categoryId,
      requiredQuantity: 1,
      unit: "pieces",
      beneficiaries: { kind: "family" },
      responsibleMemberId: j.owner.id,
      ...fields,
    },
    "POST",
  );
  assert.equal(r.status, 201, fixture.logs());
  return r.data.entry.id as string;
}
async function receive(j: Journey, id: string) {
  const r = await fixture.request(
    `${j.family}/checklist/entries/${id}/acquisition`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      from: "remaining",
      to: "received",
      quantity: 1,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(r.status, 200, fixture.logs());
}
test("overview keeps the missing essential prominent and every action count opens its exact persisted records", async () => {
  const j = await setup("overview_counts");
  const essential = await entry(j, "Passport", { priority: "essential" });
  const ready = await entry(j, "Adapter");
  await receive(j, ready);
  for (let n = 2; n <= 19; n++) {
    const id = await entry(j, `Available supply ${n}`);
    await receive(j, id);
  }
  const task = await entry(j, "Check booking", {
    kind: "task",
    taskStatus: "in_progress",
    requiredQuantity: null,
    unit: "",
  });
  const phase = await fixture.request(
    `${j.trip}/itinerary`,
    j.owner.token,
    { phase: "preparing_at_home" },
    "PATCH",
  );
  assert.equal(phase.status, 200, fixture.logs());
  const r = await fixture.request(`${j.trip}/overview`, j.owner.token);
  assert.equal(r.status, 200, fixture.logs());
  assert.equal(overviewResponse.safeParse(r.data).success, true);
  assert.equal(r.data.phase, "preparing_at_home");
  assert.equal(r.data.nextDeparture.date, "2090-01-02");
  assert.equal(r.data.nextDeparture.precision, "date");
  assert.deepEqual(
    r.data.actions.find((a: { key: string }) => a.key === "essentials").records,
    [{ kind: "item", id: essential }],
  );
  assert.equal(r.data.preparation.availableItems, 19);
  assert.equal(r.data.preparation.activeItems, 20);
  assert.equal(r.data.readiness.verification, "not_verified");
  for (const action of r.data.actions) {
    const opened = await fixture.request(
      `${j.trip}/overview?attention=${action.key}`,
      j.owner.token,
    );
    assert.equal(opened.status, 200, fixture.logs());
    assert.deepEqual(
      opened.data.records.map((v: { kind: string; id: string }) => ({
        kind: v.kind,
        id: v.id,
      })),
      action.records,
    );
    assert.equal(opened.data.records.length, action.count);
  }
  assert.ok(r.data.records.some((v: { id: string }) => v.id === task));
  await fixture.restartApi();
  const reopened = await fixture.request(
    `${j.trip}/overview?attention=essentials`,
    j.owner.token,
  );
  assert.deepEqual(
    reopened.data.records.map((v: { id: string }) => v.id),
    [essential],
  );
});

async function admit(
  j: Journey,
  name: string,
  tripRole = "member",
  familyRole?: string,
) {
  const person = await member(name);
  const offer = await fixture.request(
    `${j.trip}/invitations`,
    j.owner.token,
    {
      recipient: { kind: "username", value: name },
      tripRole,
      ...(familyRole ? { familyId: j.familyId, familyRole } : {}),
    },
    "POST",
  );
  assert.equal(offer.status, 201, fixture.logs());
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${offer.data.invitation.id}/accept`,
        person.token,
        {},
        "POST",
      )
    ).status,
    200,
    fixture.logs(),
  );
  return person;
}
async function share(
  j: Journey,
  kind: "entries" | "bags",
  id: string,
  audience = "trip",
) {
  const r = await fixture.request(
    `${j.family}/${kind === "entries" ? "checklist/entries" : "bags"}/${id}/visibility`,
    j.owner.token,
    { requestId: randomUUID(), audience },
    "POST",
  );
  assert.equal(r.status, 200, fixture.logs());
}
async function bag(j: Journey, name: string) {
  const traveler = await fixture.request(
    `${j.family}/travelers`,
    j.owner.token,
    { firstName: "PrivateChild", lastName: "Ahmed" },
    "POST",
  );
  const r = await fixture.request(
    `${j.family}/bags`,
    j.owner.token,
    {
      requestId: randomUUID(),
      name,
      type: "Suitcase",
      carrierTravelerId: traveler.data.traveler.id,
      identifyingNote: "Private ribbon",
    },
    "POST",
  );
  assert.equal(r.status, 201, fixture.logs());
  return r.data.bags.find((b: { name: string }) => b.name === name)
    .id as string;
}
async function pack(j: Journey, id: string, bagId: string) {
  const r = await fixture.request(
    `${j.family}/packing`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      leg: "outbound",
      entryId: id,
      from: { kind: "unpacked" },
      to: { kind: "bag", id: bagId },
      quantity: 1,
      physicalConfirmed: true,
      reason: "Private location explanation",
    },
    "POST",
  );
  assert.equal(r.status, 200, fixture.logs());
}
test("item search and activity expose only the permitted confirmed leg and actor/action, with private carrying details kept opaque", async () => {
  const j = await setup("overview_search");
  const reader = await admit(j, "overview_search_reader", "viewer");
  const id = await entry(j, "Essential medicine", { priority: "essential" });
  const unrelated = await entry(j, "Secret contents");
  const hidden = await bag(j, "Private medicine bag");
  await receive(j, id);
  await share(j, "entries", id);
  await pack(j, id, hidden);
  const search = await fixture.request(
    `${j.trip}/overview?q=medicine`,
    reader.token,
  );
  assert.equal(search.status, 200, fixture.logs());
  assert.deepEqual(
    search.data.records.map((r: { id: string }) => r.id),
    [id],
  );
  assert.deepEqual(search.data.records[0].locations, [
    { kind: "private", label: "Private carrying location", quantity: 1 },
  ]);
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/overview?q=Private%20medicine%20bag`,
        reader.token,
      )
    ).data.records.length,
    0,
  );
  const own = await fixture.request(
    `${j.trip}/overview?q=Private%20medicine%20bag`,
    j.owner.token,
  );
  assert.ok(own.data.records.some((r: { id: string }) => r.id === id));
  const activity = await fixture.request(
    `${j.trip}/overview/activity?entryId=${id}`,
    reader.token,
  );
  assert.equal(activity.status, 200, fixture.logs());
  assert.equal(overviewActivityResponse.safeParse(activity.data).success, true);
  assert.ok(activity.data.history.length > 0);
  assert.ok(
    activity.data.history.every(
      (h: { actor: { id: string }; at: string; action: string }) =>
        h.actor.id === j.owner.id && h.at && h.action,
    ),
  );
  const encoded = JSON.stringify({
    search: search.data,
    activity: activity.data,
  });
  for (const secret of [
    hidden,
    unrelated,
    "Private medicine bag",
    "PrivateChild",
    "Private ribbon",
    "Private location explanation",
    "Secret contents",
    "@example.test",
    "changes",
    "command",
  ])
    assert.ok(!encoded.includes(secret), secret);
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/overview/activity?entryId=${unrelated}`,
        reader.token,
      )
    ).status,
    404,
  );
  const unknownReturn = await fixture.request(
    `${j.trip}/overview?leg=return&q=medicine`,
    reader.token,
  );
  assert.equal(unknownReturn.data.records.length, 1);
  assert.equal(unknownReturn.data.records[0].available, null);
  assert.deepEqual(unknownReturn.data.records[0].locations, []);
  const visibleBag = await bag(j, "Shared blue suitcase");
  await share(j, "bags", visibleBag);
  const moved = await fixture.request(
    `${j.family}/packing`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      leg: "outbound",
      entryId: id,
      from: { kind: "bag", id: hidden },
      to: { kind: "bag", id: visibleBag },
      quantity: 1,
      physicalConfirmed: true,
      reason: "Private ribbon",
    },
    "POST",
  );
  assert.equal(moved.status, 200, fixture.logs());
  const located = await fixture.request(
    `${j.trip}/overview?q=medicine`,
    reader.token,
  );
  assert.deepEqual(located.data.records[0].locations, [
    { kind: "bag", id: visibleBag, label: "Shared blue suitcase", quantity: 1 },
  ]);
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/overview/activity?entryId=${id}`,
        reader.token,
      )
    ).data.history.some((h: { action: string }) => h.action === "moved"),
    false,
  );
  await share(j, "bags", visibleBag, "family");
  assert.ok(
    !JSON.stringify(
      (await fixture.request(`${j.trip}/overview?q=medicine`, reader.token))
        .data,
    ).includes(visibleBag),
  );
});

test("multi-family filters deduplicate shared IDs, keep organizing separate, and recheck grants and removed trip access", async () => {
  const j = await setup("overview_roles");
  const organizer = await admit(j, "overview_organizer", "organizer");
  const editor = await admit(j, "overview_editor", "member", "editor");
  const viewer = await admit(j, "overview_viewer", "viewer", "viewer");
  const outsider = await member("overview_unrelated");
  const own = await entry(j, "Family medicine", { priority: "essential" });
  const shared = await entry(j, "Shared adapter");
  await share(j, "entries", shared);
  const otherFamily = await fixture.request(
    `${j.trip}/families`,
    organizer.token,
    { name: "Other private family" },
    "POST",
  );
  assert.equal(otherFamily.status, 201, fixture.logs());
  const familyId = otherFamily.data.family.id as string;
  const category = await fixture.request(
    `${j.trip}/families/${familyId}/checklist/categories`,
    organizer.token,
    { name: "Other category" },
    "POST",
  );
  const other: Journey = {
    ...j,
    owner: organizer,
    familyId,
    family: `${j.trip}/families/${familyId}`,
    categoryId: category.data.category.id,
  };
  const secret = await entry(other, "Other family secret");
  const publicOther = await entry(other, "Trip water");
  await share(other, "entries", publicOther);
  for (const person of [j.owner, editor, viewer]) {
    const all = await fixture.request(`${j.trip}/overview`, person.token);
    assert.equal(all.status, 200, fixture.logs());
    assert.equal(overviewResponse.safeParse(all.data).success, true);
    assert.deepEqual(
      new Set(all.data.records.map((r: { id: string }) => r.id)),
      new Set([own, shared, publicOther]),
    );
    assert.equal(
      all.data.records.filter((r: { id: string }) => r.id === shared).length,
      1,
    );
    const family = await fixture.request(
      `${j.trip}/overview?scope=family`,
      person.token,
    );
    assert.deepEqual(
      new Set(family.data.records.map((r: { id: string }) => r.id)),
      new Set([own, shared]),
    );
    const tripShared = await fixture.request(
      `${j.trip}/overview?scope=shared`,
      person.token,
    );
    assert.deepEqual(
      new Set(tripShared.data.records.map((r: { id: string }) => r.id)),
      new Set([shared, publicOther]),
    );
    assert.equal(
      (
        await fixture.request(
          `${j.trip}/overview?scope=family&familyId=${familyId}`,
          person.token,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await fixture.request(
          `${j.trip}/overview/activity?entryId=${secret}`,
          person.token,
        )
      ).status,
      404,
    );
  }
  const mine = await fixture.request(
    `${j.trip}/overview?scope=mine`,
    j.owner.token,
  );
  assert.deepEqual(
    new Set(mine.data.records.map((r: { id: string }) => r.id)),
    new Set([own, shared]),
  );
  assert.deepEqual(
    (await fixture.request(`${j.trip}/overview?scope=mine`, editor.token)).data
      .records,
    [],
  );
  const org = await fixture.request(`${j.trip}/overview`, organizer.token);
  assert.ok(!JSON.stringify(org.data).includes(own));
  assert.ok(org.data.records.some((r: { id: string }) => r.id === secret));
  assert.equal(
    (await fixture.request(`${j.trip}/overview`, outsider.token)).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/overview/activity?entryId=${shared}`,
        outsider.token,
      )
    ).status,
    404,
  );
  const removedFamily = await fixture.request(
    `${j.family}/members/${editor.id}`,
    j.owner.token,
    undefined,
    "DELETE",
  );
  assert.equal(removedFamily.status, 200, fixture.logs());
  const after = await fixture.request(`${j.trip}/overview`, editor.token);
  assert.deepEqual(
    new Set(after.data.records.map((r: { id: string }) => r.id)),
    new Set([shared, publicOther]),
  );
  assert.equal(
    after.data.records.find((r: { id: string }) => r.id === shared).access,
    "shared",
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/overview/activity?entryId=${own}`,
        editor.token,
      )
    ).status,
    404,
  );
  await share(j, "entries", shared, "family");
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/overview/activity?entryId=${shared}`,
        editor.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/members/${editor.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${j.trip}/overview`, editor.token)).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/overview/activity?entryId=${publicOther}`,
        editor.token,
      )
    ).status,
    404,
  );
});

test("scheduled travel retains its zone, while an essential in an unreviewed bag cannot imply verified readiness", async () => {
  const j = await setup("overview_readiness");
  const id = await entry(j, "Essential documents", { priority: "essential" });
  const b = await bag(j, "Document case");
  await receive(j, id);
  await pack(j, id, b);
  const state = {
    requestId: randomUUID(),
    leg: "outbound",
    status: "ready",
    reviewConfirmed: true,
  };
  assert.equal(
    (
      await fixture.request(
        `${j.family}/bags/${b}/state`,
        j.owner.token,
        state,
        "POST",
      )
    ).status,
    200,
  );
  const scheduled = await fixture.request(
    `${j.trip}/itinerary/entries`,
    j.owner.token,
    {
      kind: "stop",
      title: "Flight to Jeddah",
      startsAt: {
        dateTime: "2090-01-02T10:00:00+03:00",
        timeZone: "Asia/Riyadh",
      },
      transportReference: "Synthetic flight",
    },
    "POST",
  );
  assert.equal(scheduled.status, 201, fixture.logs());
  const before = await fixture.request(`${j.trip}/overview`, j.owner.token);
  assert.equal(before.data.nextDeparture.label, "Flight to Jeddah");
  assert.equal(before.data.nextDeparture.at.timeZone, "Asia/Riyadh");
  assert.equal(
    before.data.nextDeparture.at.dateTime,
    "2090-01-02T10:00:00+03:00",
  );
  assert.equal(before.data.readiness.confirmedBags, 1);
  assert.equal(
    before.data.actions.find((a: { key: string }) => a.key === "essentials")
      .count,
    0,
  );
  assert.ok(
    before.data.records.find((r: { id: string }) => r.id === id).confirmedAt,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/bags/${b}`,
        j.owner.token,
        { requestId: randomUUID(), weightNote: "Changed; recheck physically" },
        "PATCH",
      )
    ).status,
    200,
  );
  const after = await fixture.request(`${j.trip}/overview`, j.owner.token);
  assert.equal(after.data.readiness.verification, "not_verified");
  assert.equal(after.data.readiness.confirmedBags, 0);
  assert.equal(after.data.readiness.unknownOrReviewBags, 1);
  assert.deepEqual(
    after.data.actions.find((a: { key: string }) => a.key === "essentials")
      .records,
    [{ kind: "item", id }],
  );
  for (const invalid of [
    "scope=everyone",
    "leg=both",
    "familyId=broken",
    "scope=mine&scope=shared",
    "unexpected=value",
    "q=" + "x".repeat(121),
  ])
    assert.equal(
      (await fixture.request(`${j.trip}/overview?${invalid}`, j.owner.token))
        .status,
      422,
    );
  assert.equal(
    (await fixture.request(`${j.trip}/overview/activity`, j.owner.token))
      .status,
    422,
  );
});

test("return overview uses independent reviewed possession and locations while preserving outbound search and family-only reconciliation", async () => {
  const j = await setup("overview_return");
  const reader = await admit(j, "overview_return_reader", "viewer");
  const id = await entry(j, "Return medicine", { priority: "essential" });
  const b = await bag(j, "Reusable case");
  await receive(j, id);
  await pack(j, id, b);
  await share(j, "entries", id);
  await share(j, "bags", b);
  const unknown = await fixture.request(
    `${j.trip}/overview/return?q=medicine`,
    reader.token,
  );
  assert.equal(
    unknown.data.records.length,
    1,
    "An essential still needs return review before any proposal exists.",
  );
  assert.equal(unknown.data.records[0].available, null);
  assert.equal(unknown.data.records[0].requiredQuantity, null);
  assert.deepEqual(unknown.data.records[0].locations, []);
  assert.ok(unknown.data.records[0].attention.includes("essentials"));
  const propose = await fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
    { requestId: randomUUID(), kind: "propose" },
    "POST",
  );
  assert.equal(propose.status, 200, fixture.logs());
  const pending = await fixture.request(
    `${j.trip}/overview/return`,
    j.owner.token,
  );
  assert.equal(pending.status, 200, fixture.logs());
  assert.equal(pending.headers.get("cache-control"), "private, no-store");
  const pendingItem = pending.data.records.find(
    (r: { id: string }) => r.id === id,
  );
  assert.ok(
    pendingItem,
    "An outbound proposal must be present in the independent return view.",
  );
  assert.equal(pendingItem.available, 0);
  assert.deepEqual(pendingItem.locations, []);
  assert.equal(pendingItem.remainingToPrepare, 1);
  assert.ok(
    pending.data.actions
      .find((a: { key: string }) => a.key === "essentials")
      .records.some((r: { id: string }) => r.id === id),
  );
  const reconcile = await fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "reconcile",
      entryId: id,
      fields: { requiredQuantity: 1, possessionQuantity: 1 },
      reviewConfirmed: true,
      physicalConfirmed: true,
      reason: "Private return reconciliation",
    },
    "POST",
  );
  assert.equal(reconcile.status, 200, fixture.logs());
  const move = await fixture.request(
    `${j.family}/packing`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      leg: "return",
      entryId: id,
      from: { kind: "unpacked" },
      to: { kind: "bag", id: b },
      quantity: 1,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(move.status, 200, fixture.logs());
  const returned = await fixture.request(
    `${j.trip}/overview/return?q=medicine`,
    reader.token,
  );
  assert.equal(returned.status, 200, fixture.logs());
  assert.equal(overviewResponse.safeParse(returned.data).success, true);
  assert.deepEqual(
    returned.data.records.map((r: { id: string }) => r.id),
    [id],
  );
  assert.equal(returned.data.records[0].leg, "return");
  assert.equal(returned.data.records[0].available, 1);
  assert.deepEqual(returned.data.records[0].locations, [
    { kind: "bag", id: b, label: "Reusable case", quantity: 1 },
  ]);
  const history = await fixture.request(
    `${j.trip}/overview/activity?entryId=${id}&leg=return`,
    reader.token,
  );
  assert.equal(history.status, 200, fixture.logs());
  assert.ok(
    history.data.history.some(
      (h: { action: string; leg: string }) =>
        h.action === "packed" && h.leg === "return",
    ),
  );
  assert.ok(
    !JSON.stringify(history.data).includes("Private return reconciliation"),
  );
  assert.equal(
    (await fixture.request(`${j.family}/return-preparation`, reader.token))
      .status,
    404,
  );
  const outbound = await fixture.request(
    `${j.trip}/overview?q=medicine`,
    reader.token,
  );
  assert.equal(outbound.data.records[0].leg, "outbound");
  assert.equal(outbound.data.records[0].locations[0].id, b);
});

test("fractional bag and traveler allocations do not create a phantom missing essential", async () => {
  const j = await setup("overview_fraction");
  const id = await entry(j, "Essential measured supply", {
    priority: "essential",
  });
  const b = await bag(j, "Measured bag");
  const traveler = await fixture.request(
    `${j.family}/travelers`,
    j.owner.token,
    { firstName: "Noor", lastName: "Ahmed" },
    "POST",
  );
  await receive(j, id);
  for (const [to, quantity] of [
    [{ kind: "bag", id: b }, 0.7],
    [{ kind: "traveler", id: traveler.data.traveler.id }, 0.3],
  ] as const) {
    const r = await fixture.request(
      `${j.family}/packing`,
      j.owner.token,
      {
        requestId: randomUUID(),
        kind: "move",
        leg: "outbound",
        entryId: id,
        from: { kind: "unpacked" },
        to,
        quantity,
        physicalConfirmed: true,
      },
      "POST",
    );
    assert.equal(r.status, 200, fixture.logs());
  }
  assert.equal(
    (
      await fixture.request(
        `${j.family}/bags/${b}/state`,
        j.owner.token,
        {
          requestId: randomUUID(),
          leg: "outbound",
          status: "ready",
          reviewConfirmed: true,
        },
        "POST",
      )
    ).status,
    200,
  );
  const r = await fixture.request(`${j.trip}/overview`, j.owner.token);
  assert.equal(
    r.data.records.find((row: { id: string }) => row.id === id)
      .remainingToPlace,
    0,
  );
  assert.deepEqual(
    r.data.actions.find((a: { key: string }) => a.key === "essentials").records,
    [],
  );
});

test("essential tasks remain actionable without being counted as item preparation or packing", async () => {
  const j = await setup("overview_task");
  const id = await entry(j, "Verify travel permission", {
    kind: "task",
    priority: "essential",
    taskStatus: "to_do",
    requiredQuantity: null,
    unit: "",
  });
  const open = await fixture.request(
    `${j.trip}/overview?attention=essentials`,
    j.owner.token,
  );
  assert.deepEqual(
    open.data.records.map((r: { id: string }) => r.id),
    [id],
  );
  assert.equal(open.data.preparation.activeItems, 0);
  assert.deepEqual(open.data.records[0].locations, []);
  assert.equal(
    (
      await fixture.request(
        `${j.family}/checklist/entries/${id}`,
        j.owner.token,
        { requestId: randomUUID(), taskStatus: "done" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (
      await fixture.request(
        `${j.trip}/overview?attention=essentials`,
        j.owner.token,
      )
    ).data.records,
    [],
  );
});
