import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";
import { packingResponse, returnPreparationResponse } from "@nmt/contracts";

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
test("return proposals retain outbound locations but require independent review and possession", async () => {
  const j = await setup("return_proposal");
  const b = await bag(j);
  const s = await supply(j, 4, 4);
  const moved = await fixture.request(
    j.packing,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      leg: "outbound",
      entryId: s.entryId,
      from: { kind: "unpacked" },
      to: { kind: "bag", id: b.id },
      quantity: 4,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(moved.status, 200, fixture.logs());
  const outbound = await fixture.request(j.packing, j.owner.token);
  const proposed = await fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
    { requestId: randomUUID(), kind: "propose" },
    "POST",
  );
  assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
  const item = proposed.data.items[0];
  assert.equal(item.entryId, s.entryId);
  assert.equal(item.reviewed, false);
  assert.equal(item.possessionConfirmedAt, null);
  assert.equal(item.possessionQuantity, 0);
  assert.equal(item.sourceQuantity, 4);
  assert.equal(item.unaccounted, 4);
  assert.deepEqual(item.lastConfirmedLocations, [
    { leg: "outbound", location: { kind: "bag", id: b.id }, quantity: 4 },
  ]);
  const ret = await fixture.request(`${j.packing}?leg=return`, j.owner.token);
  assert.equal(ret.status, 200, fixture.logs());
  assert.equal(ret.data.leg, "return");
  assert.equal(ret.data.items[0].available, 0);
  assert.deepEqual(ret.data.items[0].allocations, []);
  assert.equal(
    ret.data.bags[0].legs.find((l: { leg: string }) => l.leg === "return")
      .status,
    "packing",
  );
  const blocked = await fixture.request(
    j.packing,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      leg: "return",
      entryId: s.entryId,
      from: { kind: "unpacked" },
      to: { kind: "bag", id: b.id },
      quantity: 1,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(blocked.status, 409);
  assert.deepEqual(
    (await fixture.request(j.packing, j.owner.token)).data,
    outbound.data,
  );
});

async function propose(j: Awaited<ReturnType<typeof setup>>) {
  const result = await fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
    { requestId: randomUUID(), kind: "propose" },
    "POST",
  );
  assert.equal(result.status, 200, fixture.logs());
  return result.data;
}
async function reconcile(
  j: Awaited<ReturnType<typeof setup>>,
  entryId: string,
  fields: object,
  extra: object = {},
) {
  return fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "reconcile",
      entryId,
      fields,
      reason: "Checked belongings at checkout",
      reviewConfirmed: true,
      physicalConfirmed: true,
      ...extra,
    },
    "POST",
  );
}
async function returnMove(
  j: Awaited<ReturnType<typeof setup>>,
  entryId: string,
  from: object,
  to: object,
  quantity: number,
  extra: object = {},
) {
  return fixture.request(
    j.packing,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      leg: "return",
      entryId,
      from,
      to,
      quantity,
      physicalConfirmed: true,
      ...extra,
    },
    "POST",
  );
}
test("partly consumed belongings reconcile independently and legacy writes cannot orphan verified return stock", async () => {
  const j = await setup("return_reconcile");
  const b = await bag(j);
  const s = await supply(j, 4, 4);
  await propose(j);
  const confirmed = await reconcile(j, s.entryId, {
    requiredQuantity: 2,
    possessionQuantity: 2,
    consumed: { quantity: 0.5, explanation: "Used during stay" },
    gifted: { quantity: 0.5, explanation: "Given to cousin" },
    left: { quantity: 0.5, explanation: "Left with host" },
    lost: { quantity: 0.5, explanation: "Missing after transfer" },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.items[0].unaccounted, 0);
  assert.equal(confirmed.data.items[0].remainingToVerify, 0);
  const packed = await returnMove(
    j,
    s.entryId,
    { kind: "unpacked" },
    { kind: "bag", id: b.id },
    2,
  );
  assert.equal(packed.status, 200, fixture.logs());
  assert.equal(packed.data.items[0].packed, 2);
  assert.equal(packingResponse.safeParse(packed.data).success, true);
  const before = await fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
  );
  assert.equal(
    (
      await reconcile(j, s.entryId, {
        possessionQuantity: 1,
        lost: { quantity: 1.5, explanation: "Actually missing" },
      })
    ).status,
    409,
  );
  assert.deepEqual(
    (await fixture.request(`${j.family}/return-preparation`, j.owner.token))
      .data,
    before.data,
  );
  const removed = await fixture.request(
    s.entryPath,
    j.owner.token,
    { requestId: randomUUID(), reason: "Remove old outbound requirement" },
    "DELETE",
  );
  assert.equal(
    removed.status,
    409,
    "A legacy deletion cannot hide current return possession",
  );
});

test("destination purchases and checked gifts use acquisition but require fresh return possession, with atomic corrections and current retries", async () => {
  const j = await setup("return_destination");
  const b = await bag(j);
  const s = await supply(j, 3, 1);
  assert.equal(
    (
      await fixture.request(
        s.entryPath,
        j.owner.token,
        { requestId: randomUUID(), leg: "return" },
        "PATCH",
      )
    ).status,
    200,
  );
  await propose(j);
  let returned = (
    await fixture.request(`${j.family}/return-preparation`, j.owner.token)
  ).data.items[0];
  assert.equal(returned.origin, "destination");
  assert.equal(returned.sourceQuantity, 1);
  assert.equal(returned.possessionQuantity, 0);
  const missing = await reconcile(
    j,
    s.entryId,
    { possessionQuantity: 1 },
    { physicalConfirmed: false },
  );
  assert.equal(missing.status, 422);
  const reviewed = await reconcile(
    j,
    s.entryId,
    { possessionQuantity: 1 },
    { reviewConfirmed: false },
  );
  assert.equal(reviewed.status, 422);
  assert.equal(
    (await reconcile(j, s.entryId, { possessionQuantity: 2 })).status,
    409,
  );
  const bought = await fixture.request(
    `${s.entryPath}/acquisition`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      from: "remaining",
      to: "bought",
      quantity: 2,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(bought.status, 200, fixture.logs());
  const confirmed = await reconcile(j, s.entryId, { possessionQuantity: 3 });
  assert.equal(confirmed.status, 200, fixture.logs());
  const command = {
    requestId: randomUUID(),
    kind: "move",
    leg: "return",
    entryId: s.entryId,
    from: { kind: "unpacked" },
    to: { kind: "bag", id: b.id },
    quantity: 2,
    physicalConfirmed: true,
  };
  const lost = await fetch(`${fixture.url}${j.packing}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${j.owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  assert.equal(lost.status, 200);
  await lost.body!.cancel();
  assert.equal(
    (
      await returnMove(
        j,
        s.entryId,
        { kind: "bag", id: b.id },
        { kind: "traveler", id: j.travelerId },
        0.5,
      )
    ).status,
    200,
  );
  const before = (
    await fixture.request(`${j.packing}?leg=return`, j.owner.token)
  ).data;
  const retried = await fixture.request(
    j.packing,
    j.owner.token,
    command,
    "POST",
  );
  assert.equal(retried.status, 200);
  assert.deepEqual(retried.data, before);
  const blocked = await fixture.request(
    `${s.entryPath}/acquisition`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "correct",
      fields: { bought: 0 },
      reason: "Purchase returned",
    },
    "POST",
  );
  assert.equal(blocked.status, 409);
  assert.equal(
    (
      await fixture.request(
        s.entryPath,
        j.owner.token,
        { requestId: randomUUID(), unit: "boxes", reason: "Change unit" },
        "PATCH",
      )
    ).status,
    422,
  );
  const invalidNotNeeded = await fixture.request(
    `${s.entryPath}/acquisition`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "correct",
      fields: { bought: 0, received: 0, notNeededReason: "Leave behind" },
      reason: "Leave behind",
    },
    "POST",
  );
  assert.equal(invalidNotNeeded.status, 409);
  assert.equal(
    (await fixture.request(`${j.packing}?leg=return`, j.owner.token)).data
      .items[0].packed,
    1.5,
  );
  const removed = await returnMove(
    j,
    s.entryId,
    { kind: "bag", id: b.id },
    { kind: "unpacked" },
    1.5,
    { reason: "Check quantities" },
  );
  assert.equal(removed.status, 200);
  assert.equal(
    (
      await returnMove(
        j,
        s.entryId,
        { kind: "traveler", id: j.travelerId },
        { kind: "unpacked" },
        0.5,
        { reason: "Check quantities" },
      )
    ).status,
    200,
  );
  const correction = {
    requestId: randomUUID(),
    kind: "reconcile",
    entryId: s.entryId,
    fields: {
      possessionQuantity: 1,
      lost: { quantity: 2, explanation: "Lost after purchase" },
    },
    reason: "Recounted",
    physicalConfirmed: true,
  };
  const duplicates = await Promise.all([
    fixture.request(
      `${j.family}/return-preparation`,
      j.owner.token,
      correction,
      "POST",
    ),
    fixture.request(
      `${j.family}/return-preparation`,
      j.owner.token,
      correction,
      "POST",
    ),
  ]);
  assert.deepEqual(
    duplicates.map((r) => r.status),
    [200, 200],
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/return-preparation`,
        j.owner.token,
        { ...correction, fields: { possessionQuantity: 2 } },
        "POST",
      )
    ).status,
    409,
  );
  const state = (
    await fixture.request(`${j.packing}?leg=return`, j.owner.token)
  ).data;
  assert.equal(state.items[0].available, 1);
  assert.equal(state.items[0].needsRepacking, 1);
  const rename = await fixture.request(
    s.entryPath,
    j.owner.token,
    { title: "Replacement adapters", requestId: randomUUID() },
    "PATCH",
  );
  assert.equal(rename.status, 200);
  const retry = await fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
    correction,
    "POST",
  );
  assert.equal(retry.data.items[0].title, "Replacement adapters");
  assert.equal(retry.data.items[0].possessionQuantity, 1);
});

test("changing a reviewed return requirement requires fresh review and never carries an old confirmation", async () => {
  const j = await setup("return_review_again");
  const s = await supply(j, 4, 4);
  await propose(j);
  assert.equal(
    (await reconcile(j, s.entryId, { possessionQuantity: 4 })).status,
    200,
  );
  const unreviewed = await reconcile(
    j,
    s.entryId,
    { requiredQuantity: 3 },
    { reviewConfirmed: false },
  );
  assert.equal(unreviewed.status, 422);
  const unchanged = (
    await fixture.request(`${j.family}/return-preparation`, j.owner.token)
  ).data.items[0];
  assert.equal(unchanged.requiredQuantity, 4);
});

test("return checkout, accessible essentials and home collection are manual and isolated from outbound history", async () => {
  const j = await setup("return_checkout");
  const b = await bag(j);
  const s = await supply(j, 4, 4);
  assert.equal(
    (
      await fixture.request(
        j.packing,
        j.owner.token,
        {
          requestId: randomUUID(),
          kind: "move",
          leg: "outbound",
          entryId: s.entryId,
          from: { kind: "unpacked" },
          to: { kind: "bag", id: b.id },
          quantity: 4,
          physicalConfirmed: true,
        },
        "POST",
      )
    ).status,
    200,
  );
  const old = (await fixture.request(j.packing, j.owner.token)).data;
  const proposed = await propose(j);
  assert.equal(proposed.checkout.length, 4);
  assert.ok(
    proposed.checkout.every((check: { checked: boolean }) => !check.checked),
  );
  assert.equal(
    (
      await reconcile(j, s.entryId, {
        requiredQuantity: 3,
        possessionQuantity: 3,
        consumed: { quantity: 1, explanation: "Used during stay" },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await returnMove(
        j,
        s.entryId,
        { kind: "unpacked" },
        { kind: "bag", id: b.id },
        2,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await returnMove(
        j,
        s.entryId,
        { kind: "unpacked" },
        { kind: "traveler", id: j.travelerId },
        1,
      )
    ).status,
    200,
  );
  const check = await fixture.request(
    `${j.packing}/departure-checks?leg=return`,
    j.owner.token,
    {
      requestId: randomUUID(),
      label: "Adapters remain accessible",
      entryId: s.entryId,
      location: { kind: "traveler", id: j.travelerId },
      checked: true,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(check.status, 201, fixture.logs());
  assert.equal(check.data.checks[0].leg, "return");
  const ready = await fixture.request(
    `${j.family}/bags/${b.id}/state`,
    j.owner.token,
    { requestId: randomUUID(), leg: "return", status: "ready" },
    "POST",
  );
  assert.equal(ready.status, 200);
  const moved = await returnMove(
    j,
    s.entryId,
    { kind: "bag", id: b.id },
    { kind: "traveler", id: j.travelerId },
    1,
  );
  assert.equal(moved.status, 200);
  assert.equal(moved.data.bags[0].legs[0].needsReview, true);
  assert.equal(moved.data.checks[0].checked, false);
  const sourceEvent = moved.data.history.find(
    (event: { canUndo: boolean }) => event.canUndo,
  );
  const undo = await fixture.request(
    j.packing,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "undo",
      leg: "return",
      eventId: sourceEvent.id,
      reason: "Restored after checking",
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(undo.status, 200);
  assert.equal(undo.data.items[0].packed, 2);
  const crossUndo = await fixture.request(
    j.packing,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "undo",
      leg: "return",
      eventId: old.history.find((event: { canUndo: boolean }) => event.canUndo)
        .id,
      reason: "Wrong leg",
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(crossUndo.status, 409);
  const checkout = {
    requestId: randomUUID(),
    kind: "checkout",
    checkId: proposed.checkout[0].id,
    checked: true,
  };
  assert.equal(
    (
      await fixture.request(
        `${j.family}/return-preparation`,
        j.owner.token,
        checkout,
        "POST",
      )
    ).status,
    422,
  );
  const checked = await fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
    { ...checkout, physicalConfirmed: true },
    "POST",
  );
  assert.equal(checked.status, 200);
  assert.equal(checked.data.checkout[0].checked, true);
  const relabeled = await fixture.request(
    `${j.family}/return-preparation`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "checkout",
      checkId: checkout.checkId,
      label: "Check both bedrooms",
    },
    "POST",
  );
  assert.equal(relabeled.status, 200);
  assert.equal(relabeled.data.checkout[0].checked, false);
  const collected = await fixture.request(
    `${j.family}/bags/${b.id}/state`,
    j.owner.token,
    {
      requestId: randomUUID(),
      leg: "return",
      status: "collected",
      reviewConfirmed: true,
    },
    "POST",
  );
  assert.equal(collected.status, 200);
  assert.equal(collected.data.bags[0].legs[0].status, "collected");
  assert.equal(collected.data.items[0].packed, 2);
  assert.deepEqual((await fixture.request(j.packing, j.owner.token)).data, old);
  assert.equal(
    (
      await returnMove(
        j,
        s.entryId,
        { kind: "bag", id: b.id },
        { kind: "unpacked" },
        2,
        { reason: "Recheck at home" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await returnMove(
        j,
        s.entryId,
        { kind: "traveler", id: j.travelerId },
        { kind: "unpacked" },
        1,
        { reason: "Recheck at home" },
      )
    ).status,
    200,
  );
  const unlocated = (
    await fixture.request(`${j.family}/return-preparation`, j.owner.token)
  ).data.items[0];
  assert.deepEqual(
    unlocated.lastConfirmedLocations,
    [],
    "Removing return contents must not resurrect an older outbound location",
  );
});

async function admit(
  j: Awaited<ReturnType<typeof setup>>,
  target: Awaited<ReturnType<typeof member>>,
  roles: object = {},
) {
  const invitation = await fixture.request(
    `${j.trip}/invitations`,
    j.owner.token,
    {
      recipient: { kind: "username", value: target.username },
      tripRole: "member",
      familyId: j.familyId,
      familyRole: "editor",
      ...roles,
    },
    "POST",
  );
  assert.equal(invitation.status, 201, fixture.logs());
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${invitation.data.invitation.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    200,
  );
}
test("return reads, commands, locations and retries retain family, viewer, organizer and revocation boundaries", async () => {
  const j = await setup("return_private_owner");
  const s = await supply(j, 3, 3);
  const b = await bag(j);
  const state = await propose(j);
  assert.equal(returnPreparationResponse.safeParse(state).success, true);
  const editor = await member("return_private_editor"),
    viewer = await member("return_private_viewer"),
    organizer = await member("return_other_organizer");
  await admit(j, editor);
  await admit(j, viewer, { familyRole: "viewer" });
  await admit(j, organizer, { tripRole: "organizer" });
  assert.equal(
    (
      await fixture.request(
        `${j.family}/members/${organizer.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  const path = `${j.family}/return-preparation`;
  assert.equal((await fixture.request(path)).status, 401);
  assert.equal((await fixture.request(path, organizer.token)).status, 404);
  const read = await fixture.request(path, viewer.token);
  assert.equal(read.status, 200);
  assert.equal(read.data.canEdit, false);
  assert.match(read.headers.get("cache-control")!, /private.*no-store/);
  assert.match(read.headers.get("vary")!, /Authorization/i);
  const command = {
    requestId: randomUUID(),
    kind: "reconcile",
    entryId: s.entryId,
    fields: { possessionQuantity: 3 },
    reason: "Physically checked",
    physicalConfirmed: true,
    reviewConfirmed: true,
  };
  for (const token of [viewer.token, organizer.token]) {
    const expected = token === viewer.token ? 403 : 404;
    for (const body of [
      { requestId: randomUUID(), kind: "propose" },
      command,
      {
        requestId: randomUUID(),
        kind: "checkout",
        checkId: state.checkout[0].id,
        checked: true,
        physicalConfirmed: true,
      },
    ])
      assert.equal(
        (await fixture.request(path, token, body, "POST")).status,
        expected,
      );
    assert.equal(
      (await fixture.request(`${j.packing}?leg=return`, token)).status,
      token === viewer.token ? 200 : 404,
    );
    assert.equal(
      (
        await fixture.request(
          j.packing,
          token,
          {
            requestId: randomUUID(),
            kind: "move",
            leg: "return",
            entryId: s.entryId,
            from: { kind: "unpacked" },
            to: { kind: "bag", id: b.id },
            quantity: 1,
            physicalConfirmed: true,
          },
          "POST",
        )
      ).status,
      expected,
    );
  }
  assert.equal(
    (await fixture.request(path, editor.token, command, "POST")).status,
    200,
  );
  const other = await setup("return_foreign_owner");
  const foreign = await supply(other);
  const fb = await bag(other);
  await propose(other);
  assert.equal(
    (await reconcile(j, foreign.entryId, { possessionQuantity: 1 })).status,
    404,
  );
  assert.equal(
    (
      await returnMove(
        j,
        s.entryId,
        { kind: "unpacked" },
        { kind: "bag", id: fb.id },
        1,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        path,
        j.owner.token,
        {
          requestId: randomUUID(),
          kind: "checkout",
          checkId: (await propose(other)).checkout[0].id,
          checked: true,
          physicalConfirmed: true,
        },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/members/${editor.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(path, editor.token, command, "POST")).status,
    404,
  );
  assert.equal((await fixture.request(path, editor.token)).status, 404);
  assert.equal(
    (await fixture.request(`${j.packing}?leg=return`, editor.token)).status,
    404,
  );
  const before = (await fixture.request(path, j.owner.token)).data;
  for (const fields of [
    { possessionQuantity: -1 },
    { possessionQuantity: 0.0001 },
    { lost: { quantity: 1, explanation: "" } },
    { requiredQuantity: 1, available: 3 },
  ])
    assert.equal((await reconcile(j, s.entryId, fields)).status, 422);
  assert.deepEqual((await fixture.request(path, j.owner.token)).data, before);
  assert.equal(
    (await fixture.request(`${j.packing}?leg=sideways`, j.owner.token)).status,
    422,
  );
});
test("concurrent return packing and corrections serialize against current verified quantities without rewriting outbound", async () => {
  const j = await setup("return_concurrency");
  const s = await supply(j, 3, 3);
  const b = await bag(j);
  await propose(j);
  assert.equal(
    (await reconcile(j, s.entryId, { possessionQuantity: 3 })).status,
    200,
  );
  const outcomes = await Promise.all([
    returnMove(
      j,
      s.entryId,
      { kind: "unpacked" },
      { kind: "bag", id: b.id },
      2,
    ),
    returnMove(
      j,
      s.entryId,
      { kind: "unpacked" },
      { kind: "traveler", id: j.travelerId },
      2,
    ),
  ]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  const packed = outcomes.find((r) => r.status === 200)!.data.items[0];
  const source = packed.allocations[0].location;
  assert.equal(
    (
      await returnMove(j, s.entryId, source, { kind: "unpacked" }, 2, {
        reason: "Recheck",
      })
    ).status,
    200,
  );
  const race = await Promise.all([
    returnMove(
      j,
      s.entryId,
      { kind: "unpacked" },
      { kind: "bag", id: b.id },
      2,
    ),
    reconcile(j, s.entryId, {
      possessionQuantity: 1,
      lost: { quantity: 2, explanation: "Missing after transfer" },
    }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const actual = (
    await fixture.request(`${j.packing}?leg=return`, j.owner.token)
  ).data.items[0];
  assert.ok(
    (actual.available === 3 && actual.packed === 2) ||
      (actual.available === 1 && actual.packed === 0),
  );
  const old = (await fixture.request(j.packing, j.owner.token)).data;
  assert.equal(old.items[0].available, 3);
  assert.equal(old.items[0].packed, 0);
  assert.equal(
    (
      await fixture.request(
        `${s.entryPath}/acquisition`,
        j.owner.token,
        {
          requestId: randomUUID(),
          kind: "correct",
          fields: { received: 0 },
          reason: "Correct outbound count",
        },
        "POST",
      )
    ).status,
    200,
  );
  const unchanged = (
    await fixture.request(`${j.packing}?leg=return`, j.owner.token)
  ).data.items[0];
  assert.deepEqual(unchanged, actual);
  const ledger = (
    await fixture.request(`${j.family}/return-preparation`, j.owner.token)
  ).data.items[0];
  assert.equal(ledger.sourceQuantity, 3);
});
