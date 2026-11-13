import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";
import { packingResponse } from "@nmt/contracts";

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
  const saved = await fixture.request("/api/me", token, {
    firstName: "Sana",
    lastName: "Ahmed",
    username,
  });
  assert.equal(saved.status, 200, fixture.logs());
  return { token, id: saved.data.profile.id as string, username };
}
async function setup(username: string) {
  const owner = await member(username);
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Outbound packing",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Ahmed family",
    },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  const trip = `/api/trips/${created.data.trip.id}`;
  const familyId = created.data.families[0].id as string;
  const family = `${trip}/families/${familyId}`;
  const traveler = await fixture.request(
    `${family}/travelers`,
    owner.token,
    { firstName: "Noor", lastName: "Ahmed", requestId: randomUUID() },
    "POST",
  );
  assert.equal(traveler.status, 201, fixture.logs());
  return {
    owner,
    trip,
    family,
    familyId,
    packing: `${family}/packing`,
    travelerId: traveler.data.traveler.id as string,
  };
}
async function bag(
  journey: Awaited<ReturnType<typeof setup>>,
  name = "Blue suitcase",
) {
  const saved = await fixture.request(
    `${journey.family}/bags`,
    journey.owner.token,
    {
      requestId: randomUUID(),
      name,
      type: "Checked suitcase",
      carrierTravelerId: journey.travelerId,
      identifyingNote: "Yellow ribbon on handle",
      weightNote: "18 kg at home",
      allowanceNote: "Check our booking",
    },
    "POST",
  );
  assert.equal(saved.status, 201, fixture.logs());
  return saved.data.bags.find((value: { name: string }) => value.name === name);
}
test("named physical bags persist separately from manual outbound readiness without asserting return possession", async () => {
  const journey = await setup("packing_bag_owner");
  const saved = await bag(journey);
  assert.equal(saved.carrierTravelerId, journey.travelerId);
  assert.equal(saved.identifyingNote, "Yellow ribbon on handle");
  assert.deepEqual(
    saved.legs.map(
      (leg: { leg: string; status: string; needsReview: boolean }) => [
        leg.leg,
        leg.status,
        leg.needsReview,
      ],
    ),
    [["outbound", "packing", false]],
  );
  const state = await fixture.request(
    `${journey.family}/bags/${saved.id}/state`,
    journey.owner.token,
    { requestId: randomUUID(), leg: "outbound", status: "ready" },
    "POST",
  );
  assert.equal(state.status, 200, fixture.logs());
  const read = await fixture.request(journey.packing, journey.owner.token);
  assert.equal(read.status, 200, fixture.logs());
  assert.equal(read.data.bags[0].legs[0].status, "ready");
  assert.equal(read.data.bags[0].weightNote, "18 kg at home");
  assert.equal(read.data.bags[0].legs.length, 1);
  assert.equal(
    packingResponse.safeParse(read.data).success,
    true,
    "The native contract must accept confirmed bag timestamps.",
  );
  const unverifiedReturn = await fixture.request(
    `${journey.family}/bags/${saved.id}/state`,
    journey.owner.token,
    { requestId: randomUUID(), leg: "return", status: "ready" },
    "POST",
  );
  assert.equal(unverifiedReturn.status, 200);
  assert.equal(unverifiedReturn.data.leg, "return");
  assert.deepEqual(unverifiedReturn.data.items, []);
  assert.equal(
    (await fixture.request(journey.packing, journey.owner.token)).data.bags[0]
      .legs[0].status,
    "ready",
  );
});

async function supply(
  journey: Awaited<ReturnType<typeof setup>>,
  quantity = 4,
  available = 3,
) {
  const category = await fixture.request(
    `${journey.family}/checklist/categories`,
    journey.owner.token,
    { name: "Accessible essentials", requestId: randomUUID() },
    "POST",
  );
  assert.equal(category.status, 201, fixture.logs());
  const created = await fixture.request(
    `${journey.family}/checklist/entries`,
    journey.owner.token,
    {
      kind: "item",
      title: "Adapters",
      categoryId: category.data.category.id,
      requiredQuantity: quantity,
      unit: "pieces",
      beneficiaries: { kind: "family" },
      responsibleMemberId: journey.owner.id,
      priority: "essential",
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  const entryId = created.data.entry.id as string;
  const entryPath = `${journey.family}/checklist/entries/${entryId}`;
  const receipt = await fixture.request(
    `${entryPath}/acquisition`,
    journey.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      from: "remaining",
      to: "received",
      quantity: available,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(receipt.status, 200, fixture.logs());
  return { entryId, entryPath, acquisition: receipt.data.entry.acquisition };
}
const unpacked = { kind: "unpacked" };
const inBag = (bagId: string) => ({ kind: "bag", id: bagId });
const withTraveler = (id: string) => ({ kind: "traveler", id });
async function move(
  journey: Awaited<ReturnType<typeof setup>>,
  entryId: string,
  from: object,
  to: object,
  quantity: number,
  extra: object = {},
) {
  return fixture.request(
    journey.packing,
    journey.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      leg: "outbound",
      entryId,
      from,
      to,
      quantity,
      ...extra,
    },
    "POST",
  );
}
test("physically available quantities split between bags and a named traveler, move atomically, and undo removal with review", async () => {
  const journey = await setup("packing_moves_owner");
  const first = await bag(journey);
  const second = await bag(journey, "Small cabin bag");
  const item = await supply(journey);
  for (const [to, quantity] of [
    [inBag(first.id), 1.5],
    [inBag(second.id), 1],
    [withTraveler(journey.travelerId), 0.5],
  ] as const) {
    const packed = await move(journey, item.entryId, unpacked, to, quantity, {
      physicalConfirmed: true,
    });
    assert.equal(packed.status, 200, fixture.logs());
  }
  const over = await move(journey, item.entryId, unpacked, inBag(first.id), 1, {
    physicalConfirmed: true,
  });
  assert.equal(over.status, 409);
  await fixture.request(
    `${journey.family}/bags/${first.id}/state`,
    journey.owner.token,
    { requestId: randomUUID(), leg: "outbound", status: "ready" },
    "POST",
  );
  const moved = await move(
    journey,
    item.entryId,
    inBag(first.id),
    inBag(second.id),
    0.5,
    { physicalConfirmed: true },
  );
  assert.equal(moved.status, 200, fixture.logs());
  assert.equal(
    moved.data.bags.find((b: { id: string }) => b.id === first.id).legs[0]
      .needsReview,
    true,
  );
  const removed = await move(
    journey,
    item.entryId,
    inBag(second.id),
    unpacked,
    0.5,
    { reason: "Check plug type" },
  );
  assert.equal(removed.status, 200, fixture.logs());
  assert.equal(removed.data.items[0].needsRepacking, 0.5);
  assert.equal(removed.data.items[0].notPacked, 0.5);
  const removal = removed.data.history.find(
    (e: { action: string }) => e.action === "removed",
  );
  const undone = await fixture.request(
    journey.packing,
    journey.owner.token,
    {
      requestId: randomUUID(),
      kind: "undo",
      leg: "outbound",
      eventId: removal.id,
      reason: "Corrected accidental removal",
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(undone.status, 200, fixture.logs());
  const state = undone.data.items[0];
  assert.equal(state.notPacked, 0);
  assert.equal(state.needsRepacking, 0);
  assert.equal(state.packed, 2.5);
  assert.equal(state.keptWithTraveler, 0.5);
  assert.deepEqual(
    state.allocations.map((a: { quantity: number }) => a.quantity).sort(),
    [0.5, 1, 1.5],
  );
  const original = await fixture.request(item.entryPath, journey.owner.token);
  assert.deepEqual(original.data.entry.acquisition, item.acquisition);
  assert.equal(undone.data.history[0].actor.username, journey.owner.username);
  assert.ok(undone.data.history[0].at);
  assert.equal(JSON.stringify(undone.data).includes("@example.test"), false);
});

test("all acquisition and legacy checklist mutations reject invalidating allocations and can proceed after explicit removal", async () => {
  const journey = await setup("packing_legacy_owner");
  const target = await bag(journey);
  const item = await supply(journey);
  assert.equal(
    (
      await move(journey, item.entryId, unpacked, inBag(target.id), 2, {
        physicalConfirmed: true,
      })
    ).status,
    200,
  );
  const returned = await fixture.request(
    `${item.entryPath}/acquisition`,
    journey.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      from: "received",
      to: "remaining",
      quantity: 2,
      reason: "Returned two adapters",
    },
    "POST",
  );
  assert.equal(returned.status, 409, fixture.logs());
  for (const fields of [
    { received: 1, requiredQuantity: 1 },
    { received: 0, notNeededReason: "No longer required" },
  ]) {
    const corrected = await fixture.request(
      `${item.entryPath}/acquisition`,
      journey.owner.token,
      {
        requestId: randomUUID(),
        kind: "correct",
        fields,
        reason: "Correct the count",
      },
      "POST",
    );
    assert.equal(corrected.status, 409, fixture.logs());
  }
  for (const fields of [
    { leg: "return" },
    { requiredQuantity: 1 },
    { unit: "sets" },
  ]) {
    const changed = await fixture.request(
      item.entryPath,
      journey.owner.token,
      { ...fields, requestId: randomUUID(), reason: "Changed plan" },
      "PATCH",
    );
    assert.ok([409, 422].includes(changed.status), fixture.logs());
  }
  const deleted = await fixture.request(
    item.entryPath,
    journey.owner.token,
    { requestId: randomUUID(), reason: "Remove requirement" },
    "DELETE",
  );
  assert.equal(deleted.status, 409, fixture.logs());
  const still = await fixture.request(journey.packing, journey.owner.token);
  assert.equal(still.data.items[0].packed, 2);
  assert.equal(still.data.items[0].available, 3);
  assert.equal(
    (
      await move(journey, item.entryId, inBag(target.id), unpacked, 2, {
        reason: "Unpack before return",
      })
    ).status,
    200,
  );
  const notNeeded = {
    requestId: randomUUID(),
    kind: "correct",
    fields: { received: 0, notNeededReason: "No longer required" },
  };
  assert.equal(
    (
      await fixture.request(
        `${item.entryPath}/acquisition`,
        journey.owner.token,
        notNeeded,
        "POST",
      )
    ).status,
    200,
  );
  let state = await fixture.request(journey.packing, journey.owner.token);
  assert.equal(state.data.items.length, 0);
  assert.equal(
    (
      await fixture.request(
        `${item.entryPath}/acquisition`,
        journey.owner.token,
        {
          requestId: randomUUID(),
          kind: "correct",
          fields: { notNeededReason: null },
          reason: "Needed again",
        },
        "POST",
      )
    ).status,
    200,
  );
  state = await fixture.request(journey.packing, journey.owner.token);
  assert.equal(state.data.items[0].needsRepacking, 0);
  assert.equal(state.data.items[0].available, 0);
  assert.equal(
    (
      await fixture.request(
        item.entryPath,
        journey.owner.token,
        { requestId: randomUUID(), unit: "sets", reason: "Use new units" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        item.entryPath,
        journey.owner.token,
        { requestId: randomUUID(), reason: "Remove empty item" },
        "DELETE",
      )
    ).status,
    200,
  );
});

test("editable departure checks require a current physical location, invalidate on changes, and collection stays manual", async () => {
  const journey = await setup("packing_departure_owner");
  const target = await bag(journey);
  const item = await supply(journey, 1, 1);
  await move(
    journey,
    item.entryId,
    unpacked,
    withTraveler(journey.travelerId),
    1,
    { physicalConfirmed: true },
  );
  const check = await fixture.request(
    `${journey.packing}/departure-checks`,
    journey.owner.token,
    {
      requestId: randomUUID(),
      label: "Adapters accessible before departure",
      entryId: item.entryId,
      location: withTraveler(journey.travelerId),
      checked: true,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(check.status, 201, fixture.logs());
  const checkId = check.data.checks[0].id;
  const changed = await move(
    journey,
    item.entryId,
    withTraveler(journey.travelerId),
    inBag(target.id),
    1,
    { physicalConfirmed: true },
  );
  assert.equal(changed.status, 200, fixture.logs());
  assert.equal(changed.data.checks[0].checked, false);
  const oldLocation = await fixture.request(
    `${journey.packing}/departure-checks/${checkId}`,
    journey.owner.token,
    { requestId: randomUUID(), checked: true, physicalConfirmed: true },
    "PATCH",
  );
  assert.equal(oldLocation.status, 409);
  const corrected = await fixture.request(
    `${journey.packing}/departure-checks/${checkId}`,
    journey.owner.token,
    {
      requestId: randomUUID(),
      label: "Adapters in cabin bag",
      location: inBag(target.id),
      checked: true,
      physicalConfirmed: true,
    },
    "PATCH",
  );
  assert.equal(corrected.status, 200, fixture.logs());
  assert.equal(corrected.data.checks[0].checked, true);
  const statePath = `${journey.family}/bags/${target.id}/state`;
  assert.equal(
    (
      await fixture.request(
        statePath,
        journey.owner.token,
        { requestId: randomUUID(), leg: "outbound", status: "ready" },
        "POST",
      )
    ).status,
    200,
  );
  const edited = await fixture.request(
    `${journey.family}/bags/${target.id}`,
    journey.owner.token,
    { requestId: randomUUID(), identifyingNote: "New red ribbon" },
    "PATCH",
  );
  assert.equal(edited.status, 200, fixture.logs());
  assert.equal(edited.data.checks[0].checked, false);
  assert.equal(edited.data.bags[0].legs[0].needsReview, true);
  const ready = await fixture.request(
    statePath,
    journey.owner.token,
    { requestId: randomUUID(), leg: "outbound", status: "ready" },
    "POST",
  );
  assert.equal(ready.status, 409);
  const transit = await fixture.request(
    statePath,
    journey.owner.token,
    { requestId: randomUUID(), leg: "outbound", status: "in_transit" },
    "POST",
  );
  assert.equal(transit.status, 200);
  assert.equal(transit.data.bags[0].legs[0].needsReview, true);
  const read = await fixture.request(journey.packing, journey.owner.token);
  assert.equal(read.data.bags[0].legs[0].status, "in_transit");
  const collected = await fixture.request(
    statePath,
    journey.owner.token,
    {
      requestId: randomUUID(),
      leg: "outbound",
      status: "collected",
      reviewConfirmed: true,
    },
    "POST",
  );
  assert.equal(collected.status, 200, fixture.logs());
  assert.equal(collected.data.bags[0].legs[0].status, "collected");
  assert.equal(collected.data.bags[0].legs[0].needsReview, false);
  assert.equal(
    (
      await fixture.request(
        `${journey.family}/bags/${target.id}`,
        journey.owner.token,
        { requestId: randomUUID(), reason: "Wrong bag" },
        "DELETE",
      )
    ).status,
    409,
  );
  await move(journey, item.entryId, inBag(target.id), unpacked, 1, {
    reason: "Unpack after arrival",
  });
  assert.equal(
    (
      await fixture.request(
        `${journey.family}/bags/${target.id}`,
        journey.owner.token,
        { requestId: randomUUID(), reason: "Retire bag" },
        "DELETE",
      )
    ).status,
    200,
  );
  const removedCheck = await fixture.request(
    `${journey.packing}/departure-checks/${checkId}`,
    journey.owner.token,
    { requestId: randomUUID() },
    "DELETE",
  );
  assert.equal(removedCheck.status, 200, fixture.logs());
  assert.equal(removedCheck.data.checks.length, 0);
});

test("concurrent allocations and lost-response retries cannot duplicate quantities or replay older locations", async () => {
  const journey = await setup("packing_races_owner");
  const first = await bag(journey);
  const second = await bag(journey, "Cabin bag");
  const item = await supply(journey);
  const contenders = await Promise.all(
    [first, second].map((target) =>
      move(journey, item.entryId, unpacked, inBag(target.id), 2, {
        physicalConfirmed: true,
      }),
    ),
  );
  assert.deepEqual(
    contenders.map((r) => r.status).sort(),
    [200, 409],
    fixture.logs(),
  );
  const once = {
    requestId: randomUUID(),
    kind: "move",
    leg: "outbound",
    entryId: item.entryId,
    from: unpacked,
    to: withTraveler(journey.travelerId),
    quantity: 1,
    physicalConfirmed: true,
  };
  const duplicates = await Promise.all([
    fixture.request(journey.packing, journey.owner.token, once, "POST"),
    fixture.request(journey.packing, journey.owner.token, once, "POST"),
  ]);
  assert.deepEqual(
    duplicates.map((r) => r.status),
    [200, 200],
    fixture.logs(),
  );
  assert.equal(duplicates[1].data.items[0].keptWithTraveler, 1);
  assert.equal(
    (
      await fixture.request(
        journey.packing,
        journey.owner.token,
        { ...once, quantity: 0.5 },
        "POST",
      )
    ).status,
    409,
  );
  const winner = contenders.find((r) => r.status === 200)!.data.items[0]
    .allocations[0].location;
  const other = winner.id === first.id ? second : first;
  const lostCommand = {
    ...once,
    requestId: randomUUID(),
    from: winner,
    quantity: 0.5,
  };
  const lost = await fetch(`${fixture.url}${journey.packing}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${journey.owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(lostCommand),
  });
  assert.equal(lost.status, 200, fixture.logs());
  await lost.body!.cancel();
  assert.equal(
    (
      await move(
        journey,
        item.entryId,
        withTraveler(journey.travelerId),
        inBag(other.id),
        0.5,
        { physicalConfirmed: true },
      )
    ).status,
    200,
  );
  const beforeRetry = await fixture.request(
    journey.packing,
    journey.owner.token,
  );
  const retried = await fixture.request(
    journey.packing,
    journey.owner.token,
    lostCommand,
    "POST",
  );
  assert.equal(retried.status, 200, fixture.logs());
  assert.deepEqual(retried.data.items, beforeRetry.data.items);
  assert.deepEqual(retried.data.history, beforeRetry.data.history);
  assert.equal(retried.data.items[0].notPacked, 0);
  assert.equal(retried.data.items[0].keptWithTraveler, 1);
  assert.equal(
    retried.data.items[0].allocations.find(
      (a: { location: { id: string } }) => a.location.id === other.id,
    ).quantity,
    0.5,
  );
  const raced = await supply(journey);
  const results = await Promise.all([
    move(journey, raced.entryId, unpacked, inBag(first.id), 2, {
      physicalConfirmed: true,
    }),
    fixture.request(
      `${raced.entryPath}/acquisition`,
      journey.owner.token,
      {
        requestId: randomUUID(),
        kind: "correct",
        fields: { received: 1, requiredQuantity: 1 },
        reason: "Only one retained",
      },
      "POST",
    ),
  ]);
  assert.deepEqual(
    results.map((r) => r.status).sort(),
    [200, 409],
    fixture.logs(),
  );
  const final = (
    await fixture.request(journey.packing, journey.owner.token)
  ).data.items.find((i: { entryId: string }) => i.entryId === raced.entryId);
  assert.ok(
    (final.available === 3 && final.packed === 2) ||
      (final.available === 1 && final.packed === 0),
  );
  const changes = await Promise.all([
    fixture.request(
      `${journey.family}/bags/${first.id}`,
      journey.owner.token,
      { requestId: randomUUID(), name: "Renamed suitcase" },
      "PATCH",
    ),
    fixture.request(
      `${journey.family}/bags/${first.id}`,
      journey.owner.token,
      { requestId: randomUUID(), weightNote: "19 kg" },
      "PATCH",
    ),
  ]);
  assert.deepEqual(
    changes.map((r) => r.status),
    [200, 200],
  );
  const currentBag = (
    await fixture.request(journey.packing, journey.owner.token)
  ).data.bags.find((b: { id: string }) => b.id === first.id);
  assert.equal(currentBag.name, "Renamed suitcase");
  assert.equal(currentBag.weightNote, "19 kg");
});

async function admit(
  journey: Awaited<ReturnType<typeof setup>>,
  target: Awaited<ReturnType<typeof member>>,
  roles: object = {},
) {
  const offered = await fixture.request(
    `${journey.trip}/invitations`,
    journey.owner.token,
    {
      recipient: { kind: "username", value: target.username },
      tripRole: "member",
      familyId: journey.familyId,
      familyRole: "editor",
      ...roles,
    },
    "POST",
  );
  assert.equal(offered.status, 201, fixture.logs());
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${offered.data.invitation.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    200,
    fixture.logs(),
  );
}
test("packing reads, history, all writes and receipt retries retain current family, viewer, organizer and revocation boundaries", async () => {
  const journey = await setup("packing_private_owner");
  const editor = await member("packing_private_editor"),
    viewer = await member("packing_private_viewer"),
    organizer = await member("packing_private_organizer");
  await admit(journey, editor);
  await admit(journey, viewer, { familyRole: "viewer" });
  await admit(journey, organizer, { tripRole: "organizer" });
  const members = `${journey.family}/members`;
  assert.equal(
    (
      await fixture.request(
        `${members}/${organizer.id}`,
        journey.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  const target = await bag(journey);
  const item = await supply(journey);
  const command = {
    requestId: randomUUID(),
    kind: "move",
    leg: "outbound",
    entryId: item.entryId,
    from: unpacked,
    to: inBag(target.id),
    quantity: 1,
    physicalConfirmed: true,
  };
  assert.equal((await fixture.request(journey.packing)).status, 401);
  assert.equal(
    (await fixture.request(journey.packing, organizer.token)).status,
    404,
  );
  const read = await fixture.request(journey.packing, viewer.token);
  assert.equal(read.status, 200);
  assert.equal(read.data.canEdit, false);
  assert.match(read.headers.get("cache-control")!, /private.*no-store/);
  assert.match(read.headers.get("vary")!, /Authorization/i);
  const writes: [string, object, string][] = [
    [journey.packing, command, "POST"],
    [
      `${journey.family}/bags`,
      {
        requestId: randomUUID(),
        name: "Other",
        type: "Cabin",
        carrierTravelerId: journey.travelerId,
      },
      "POST",
    ],
    [
      `${journey.family}/bags/${target.id}`,
      { requestId: randomUUID(), name: "Forbidden" },
      "PATCH",
    ],
    [
      `${journey.family}/bags/${target.id}`,
      { requestId: randomUUID() },
      "DELETE",
    ],
    [
      `${journey.family}/bags/${target.id}/state`,
      { requestId: randomUUID(), leg: "outbound", status: "collected" },
      "POST",
    ],
    [
      `${journey.packing}/departure-checks`,
      { requestId: randomUUID(), label: "Forbidden" },
      "POST",
    ],
  ];
  for (const [path, body, method] of writes) {
    assert.equal(
      (await fixture.request(path, viewer.token, body, method)).status,
      403,
      fixture.logs(),
    );
    assert.equal(
      (await fixture.request(path, organizer.token, body, method)).status,
      404,
      fixture.logs(),
    );
  }
  assert.equal(
    (await fixture.request(journey.packing, editor.token, command, "POST"))
      .status,
    200,
  );
  const [write, revoke] = await Promise.all([
    fixture.request(
      journey.packing,
      editor.token,
      { ...command, requestId: randomUUID() },
      "POST",
    ),
    fixture.request(
      `${members}/${editor.id}`,
      journey.owner.token,
      undefined,
      "DELETE",
    ),
  ]);
  assert.ok([200, 404].includes(write.status), fixture.logs());
  assert.equal(revoke.status, 200);
  assert.equal(
    (await fixture.request(journey.packing, editor.token, command, "POST"))
      .status,
    404,
  );
  const current = await fixture.request(journey.packing, journey.owner.token);
  assert.equal(current.data.items[0].packed, write.status === 200 ? 2 : 1);
  const other = await setup("packing_foreign_owner");
  const foreignBag = await bag(other);
  assert.equal(
    (
      await move(journey, item.entryId, unpacked, inBag(foreignBag.id), 0.5, {
        physicalConfirmed: true,
      })
    ).status,
    404,
  );
  const invalidCarrier = await fixture.request(
    `${journey.family}/bags/${target.id}`,
    journey.owner.token,
    { requestId: randomUUID(), carrierTravelerId: other.travelerId },
    "PATCH",
  );
  assert.equal(invalidCarrier.status, 422);
});

test("bag creation retries return current details and never resurrect a removed bag; invalid packing leaves no history", async () => {
  const journey = await setup("packing_retry_owner");
  const command = {
    requestId: randomUUID(),
    name: "Tagged bag",
    type: "Cabin bag",
    carrierTravelerId: journey.travelerId,
  };
  const initial = await fixture.request(
    `${journey.family}/bags`,
    journey.owner.token,
    command,
    "POST",
  );
  assert.equal(initial.status, 201, fixture.logs());
  const target = initial.data.bags[0];
  assert.equal(
    (
      await fixture.request(
        `${journey.family}/bags/${target.id}`,
        journey.owner.token,
        { requestId: randomUUID(), name: "Renamed tagged bag" },
        "PATCH",
      )
    ).status,
    200,
  );
  const retried = await fixture.request(
    `${journey.family}/bags`,
    journey.owner.token,
    command,
    "POST",
  );
  assert.equal(retried.status, 201);
  assert.equal(retried.data.bags[0].name, "Renamed tagged bag");
  assert.equal(retried.data.history.length, 2);
  const item = await supply(journey, 1, 0.5);
  for (const extra of [
    { physicalConfirmed: false },
    { quantity: 0.0001, physicalConfirmed: true },
    { quantity: -1, physicalConfirmed: true },
  ]) {
    assert.equal(
      (
        await move(
          journey,
          item.entryId,
          unpacked,
          inBag(target.id),
          0.5,
          extra,
        )
      ).status,
      422,
    );
  }
  let state = await fixture.request(journey.packing, journey.owner.token);
  assert.equal(state.data.items[0].notPacked, 0.5);
  assert.equal(state.data.history.length, 2);
  const removed = await fixture.request(
    `${journey.family}/bags/${target.id}`,
    journey.owner.token,
    { requestId: randomUUID() },
    "DELETE",
  );
  assert.equal(removed.status, 200, fixture.logs());
  assert.equal(
    (
      await fixture.request(
        `${journey.family}/bags`,
        journey.owner.token,
        command,
        "POST",
      )
    ).status,
    410,
  );
  state = await fixture.request(journey.packing, journey.owner.token);
  assert.equal(state.data.bags.length, 0);
  assert.equal(state.data.history.length, 3);
  assert.ok(packingResponse.safeParse(state.data).success);
});
