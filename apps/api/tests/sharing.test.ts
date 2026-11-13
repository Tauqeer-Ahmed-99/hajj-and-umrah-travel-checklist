import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";
import { sharedContentResponse } from "@nmt/contracts";

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
async function setup(name: string) {
  const owner = await member(`${name}_owner`);
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Shared supplies",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Owning family",
    },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  const trip = `/api/trips/${created.data.trip.id}`;
  const familyId = created.data.families[0].id as string;
  const family = `${trip}/families/${familyId}`;
  const category = await fixture.request(
    `${family}/checklist/categories`,
    owner.token,
    { name: "Private category" },
    "POST",
  );
  const traveler = await fixture.request(
    `${family}/travelers`,
    owner.token,
    { firstName: "PrivateChild", lastName: "Ahmed" },
    "POST",
  );
  assert.equal(traveler.status, 201, fixture.logs());
  return {
    owner,
    trip,
    familyId,
    family,
    categoryId: category.data.category.id as string,
    travelerId: traveler.data.traveler.id as string,
  };
}
type Journey = Awaited<ReturnType<typeof setup>>;
async function admit(
  j: Journey,
  name: string,
  tripRole = "member",
  familyRole?: string,
) {
  const person = await member(name);
  const invite = await fixture.request(
    `${j.trip}/invitations`,
    j.owner.token,
    {
      recipient: { kind: "username", value: name },
      tripRole,
      ...(familyRole ? { familyId: j.familyId, familyRole } : {}),
    },
    "POST",
  );
  assert.equal(invite.status, 201, fixture.logs());
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${invite.data.invitation.id}/accept`,
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
async function item(j: Journey, title = "Shared adapters") {
  const r = await fixture.request(
    `${j.family}/checklist/entries`,
    j.owner.token,
    {
      kind: "item",
      title,
      categoryId: j.categoryId,
      requiredQuantity: 4,
      unit: "pieces",
      beneficiaries: { kind: "travelers", travelerIds: [j.travelerId] },
      responsibleMemberId: j.owner.id,
    },
    "POST",
  );
  assert.equal(r.status, 201, fixture.logs());
  return r.data.entry.id as string;
}
const visibility = (audience: string) => ({
  requestId: randomUUID(),
  audience,
});
test("only owning coordinators publish canonical items; trip editors edit and viewers only read the safe projection", async () => {
  const j = await setup("sharing_roles");
  const other = await admit(j, "sharing_other");
  const viewer = await admit(j, "sharing_viewer", "viewer");
  const organizer = await admit(j, "sharing_organizer", "organizer");
  const editor = await admit(j, "sharing_editor", "member", "editor");
  const id = await item(j);
  const path = `${j.family}/checklist/entries/${id}/visibility`;
  const shared = `${j.trip}/shared`;
  const empty = await fixture.request(shared, other.token);
  assert.equal(empty.status, 200, fixture.logs());
  assert.deepEqual(empty.data.items, []);
  for (const person of [other, viewer, organizer, editor])
    assert.ok(
      [403, 404].includes(
        (await fixture.request(path, person.token, visibility("trip"), "POST"))
          .status,
      ),
    );
  assert.equal(
    (await fixture.request(path, j.owner.token, visibility("trip"), "POST"))
      .status,
    200,
    fixture.logs(),
  );
  const read = await fixture.request(shared, other.token);
  assert.equal(read.data.items.length, 1);
  assert.equal(read.data.items[0].entry.id, id);
  assert.equal(read.data.items[0].canEdit, true);
  const encoded = JSON.stringify(read.data);
  for (const secret of [
    j.categoryId,
    j.travelerId,
    "Private category",
    "PrivateChild",
    "@example.test",
  ])
    assert.ok(!encoded.includes(secret), secret);
  assert.equal(
    (await fixture.request(`${j.family}/packing`, organizer.token)).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${shared}/items/${id}`,
        viewer.token,
        { requestId: randomUUID(), title: "Denied" },
        "PATCH",
      )
    ).status,
    403,
  );
  const edit = await fixture.request(
    `${shared}/items/${id}`,
    other.token,
    { requestId: randomUUID(), title: "Group adapters" },
    "PATCH",
  );
  assert.equal(edit.status, 200, fixture.logs());
  const canonical = await fixture.request(
    `${j.family}/checklist/entries/${id}`,
    j.owner.token,
  );
  assert.equal(canonical.data.entry.title, "Group adapters");
  assert.equal(canonical.data.entry.requiredQuantity, 4);
  assert.equal(
    (await fixture.request(shared, viewer.token)).data.items[0].canEdit,
    false,
  );
});

async function bag(j: Journey, name: string) {
  const r = await fixture.request(
    `${j.family}/bags`,
    j.owner.token,
    {
      requestId: randomUUID(),
      name,
      type: "Suitcase",
      carrierTravelerId: j.travelerId,
      identifyingNote: "Private ribbon",
    },
    "POST",
  );
  assert.equal(r.status, 201, fixture.logs());
  return r.data.bags.find((b: { name: string }) => b.name === name)
    .id as string;
}
async function receive(j: Journey, id: string, quantity = 4) {
  const r = await fixture.request(
    `${j.family}/checklist/entries/${id}/acquisition`,
    j.owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      from: "remaining",
      to: "received",
      quantity,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(r.status, 200, fixture.logs());
}
function movement(entryId: string, from: object, to: object, quantity = 1) {
  return {
    requestId: randomUUID(),
    kind: "move",
    leg: "outbound",
    entryId,
    from,
    to,
    quantity,
    physicalConfirmed: true,
  };
}
const inBag = (id: string) => ({ kind: "bag", id });
const unpacked = { kind: "unpacked" };
async function share(
  j: Journey,
  kind: "entry" | "bag",
  id: string,
  audience = "trip",
) {
  return fixture.request(
    `${j.family}/${kind === "entry" ? "checklist/entries" : "bags"}/${id}/visibility`,
    j.owner.token,
    visibility(audience),
    "POST",
  );
}
test("publishing and packing never implicitly share contents; an allocated shared item must leave shared bags before becoming private", async () => {
  const j = await setup("sharing_bags");
  const other = await admit(j, "sharing_bags_other");
  const id = await item(j);
  const b = await bag(j, "Group suitcase");
  await receive(j, id);
  assert.equal(
    (
      await fixture.request(
        `${j.family}/packing`,
        j.owner.token,
        movement(id, unpacked, inBag(b)),
        "POST",
      )
    ).status,
    200,
  );
  const refused = await share(j, "bag", b);
  assert.equal(refused.status, 409, fixture.logs());
  assert.equal(
    (await fixture.request(`${j.trip}/shared`, other.token)).data.bags.length,
    0,
  );
  assert.equal((await share(j, "entry", id)).status, 200);
  assert.equal((await share(j, "bag", b)).status, 200);
  assert.equal((await share(j, "entry", id, "family")).status, 409);
  const privateId = await item(j, "Private medicine");
  await receive(j, privateId);
  assert.equal(
    (
      await fixture.request(
        `${j.family}/packing`,
        j.owner.token,
        movement(privateId, unpacked, inBag(b)),
        "POST",
      )
    ).status,
    409,
  );
  const read = await fixture.request(`${j.trip}/shared`, other.token);
  assert.equal(read.data.bags[0].name, "Group suitcase");
  assert.ok(!JSON.stringify(read.data).includes("Private ribbon"));
  assert.ok(!JSON.stringify(read.data).includes(j.travelerId));
  assert.equal(read.data.items[0].packing.packed, 1);
  const moved = await fixture.request(
    `${j.trip}/shared/packing`,
    other.token,
    movement(id, unpacked, inBag(b)),
    "POST",
  );
  assert.equal(moved.status, 200, fixture.logs());
  assert.equal(
    (
      await fixture.request(`${j.family}/packing`, j.owner.token)
    ).data.items.find((i: { entryId: string }) => i.entryId === id).packed,
    2,
  );
});

test("several families benefit from one requirement and acquisition ledger; edits retain unrelated fields and retry current state", async () => {
  const j = await setup("sharing_ledger");
  const other = await admit(j, "sharing_ledger_other", "organizer");
  const created = await fixture.request(
    `${j.trip}/families`,
    other.token,
    { name: "Second family", requestId: randomUUID() },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  const secondId = created.data.family.id as string;
  const id = await item(j);
  await share(j, "entry", id);
  const editPath = `${j.trip}/shared/items/${id}`;
  const benefits = await fixture.request(
    editPath,
    other.token,
    {
      requestId: randomUUID(),
      beneficiaries: { kind: "families", familyIds: [j.familyId, secondId] },
    },
    "PATCH",
  );
  assert.equal(benefits.status, 200, fixture.logs());
  const command = {
    requestId: randomUUID(),
    kind: "move",
    from: "remaining",
    to: "received",
    quantity: 2,
    physicalConfirmed: true,
  };
  const responseLost = await fixture.request(
    `${editPath}/acquisition`,
    other.token,
    command,
    "POST",
  );
  assert.equal(responseLost.status, 200, fixture.logs());
  await fixture.request(
    editPath,
    j.owner.token,
    { requestId: randomUUID(), title: "One group supply" },
    "PATCH",
  );
  const retry = await fixture.request(
    `${editPath}/acquisition`,
    other.token,
    command,
    "POST",
  );
  assert.equal(retry.status, 200);
  const read = await fixture.request(`${j.trip}/shared`, other.token);
  assert.equal(read.data.items.length, 1);
  assert.equal(read.data.items[0].entry.title, "One group supply");
  assert.deepEqual(read.data.items[0].entry.beneficiaries, {
    kind: "families",
    familyIds: [j.familyId, secondId],
  });
  assert.equal(read.data.items[0].entry.acquisition.available, 2);
  assert.equal(read.data.items[0].entry.acquisition.stillToArrange, 2);
  const canonical = await fixture.request(
    `${j.family}/checklist`,
    j.owner.token,
  );
  assert.equal(canonical.data.entries.length, 1);
  assert.equal(canonical.data.entries[0].acquisition.available, 2);
  assert.equal(
    (
      await fixture.request(
        editPath,
        other.token,
        {
          requestId: randomUUID(),
          beneficiaries: { kind: "families", familyIds: [randomUUID()] },
        },
        "PATCH",
      )
    ).status,
    422,
  );
});

test("shared locations and activity redact the entire allocation history, private traveler identities, departure checks and free-text reasons", async () => {
  const j = await setup("sharing_redaction");
  const other = await admit(j, "sharing_redaction_other");
  const id = await item(j);
  const secret = await bag(j, "Secret medicine bag");
  const a = await bag(j, "Shared cabin bag");
  const b = await bag(j, "Shared checked bag");
  await receive(j, id);
  await share(j, "entry", id);
  await share(j, "bag", a);
  await share(j, "bag", b);
  const move = (from: object, to: object, extra = {}) =>
    fixture.request(
      `${j.family}/packing`,
      j.owner.token,
      { ...movement(id, from, to), ...extra },
      "POST",
    );
  assert.equal((await move(unpacked, inBag(secret))).status, 200);
  assert.equal((await move(unpacked, inBag(a))).status, 200);
  const mixedEvent = await move(inBag(a), inBag(b));
  assert.equal(mixedEvent.status, 200);
  const movedId = mixedEvent.data.history.find(
    (h: { action: string }) => h.action === "moved",
  ).id;
  await fixture.request(
    `${j.family}/packing/departure-checks`,
    j.owner.token,
    {
      requestId: randomUUID(),
      label: "Secret departure label",
      entryId: id,
      location: inBag(b),
    },
    "POST",
  );
  const read = await fixture.request(`${j.trip}/shared`, other.token);
  assert.equal(read.status, 200);
  assert.equal(sharedContentResponse.safeParse(read.data).success, true);
  assert.ok(
    read.data.items[0].packing.allocations.some(
      (a: { location: { kind: string } }) => a.location.kind === "private",
    ),
  );
  assert.ok(
    !read.data.history.some((h: { id: string }) => h.id === movedId),
    "bagIds are public here but changes.allocations still contains a private bag",
  );
  for (const secretValue of [
    secret,
    j.travelerId,
    j.categoryId,
    "Secret medicine bag",
    "Private ribbon",
    "Secret departure label",
  ])
    assert.ok(!JSON.stringify(read.data).includes(secretValue), secretValue);
  assert.equal(
    (
      await move(inBag(secret), unpacked, {
        reason: "Secret medicine bag was moved",
      })
    ).status,
    200,
  );
  const safeMove = await move(inBag(b), inBag(a), {
    reason: "Private ribbon is distinctive",
  });
  const safeId = safeMove.data.history.find(
    (h: { action: string }) => h.action === "moved",
  ).id;
  const visible = await fixture.request(`${j.trip}/shared`, other.token);
  const activity = visible.data.history.find(
    (h: { id: string }) => h.id === safeId,
  );
  assert.ok(activity, "Safe current shared moves retain actor/time activity");
  assert.equal(activity.canUndo, false);
  assert.deepEqual(activity.changes, {});
  assert.ok(!JSON.stringify(visible.data).includes("Private ribbon"));
  await share(j, "bag", a, "family");
  const hidden = await fixture.request(`${j.trip}/shared`, other.token);
  assert.ok(!JSON.stringify(hidden.data).includes(a));
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/shared/packing`,
        other.token,
        movement(id, inBag(a), inBag(b)),
        "POST",
      )
    ).status,
    404,
  );
});

test("shared bag edits and stock changes reauthorize roles and preserve allocations across concurrent updates, retries and revocation", async () => {
  const j = await setup("sharing_races");
  const other = await admit(j, "sharing_races_other");
  const viewer = await admit(j, "sharing_races_viewer", "viewer");
  const id = await item(j);
  const b = await bag(j, "Race bag");
  await receive(j, id);
  await share(j, "entry", id);
  await share(j, "bag", b);
  const shared = `${j.trip}/shared`;
  const state = { requestId: randomUUID(), leg: "outbound", status: "ready" };
  assert.equal(
    (
      await fixture.request(
        `${shared}/bags/${b}/state`,
        other.token,
        state,
        "POST",
      )
    ).status,
    200,
    fixture.logs(),
  );
  assert.equal(
    (
      await fixture.request(
        `${shared}/bags/${b}`,
        viewer.token,
        { requestId: randomUUID(), name: "Denied" },
        "PATCH",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${shared}/bags/${b}`,
        other.token,
        { requestId: randomUUID(), identifyingNote: "smuggled" },
        "PATCH",
      )
    ).status,
    422,
  );
  const edits = await Promise.all([
    fixture.request(
      `${shared}/bags/${b}`,
      other.token,
      { requestId: randomUUID(), name: "Renamed group bag" },
      "PATCH",
    ),
    fixture.request(
      `${j.family}/bags/${b}`,
      j.owner.token,
      { requestId: randomUUID(), weightNote: "19 kg" },
      "PATCH",
    ),
  ]);
  assert.deepEqual(
    edits.map((r) => r.status),
    [200, 200],
  );
  const move = movement(id, unpacked, inBag(b), 3);
  const raced = await Promise.all([
    fixture.request(`${shared}/packing`, other.token, move, "POST"),
    fixture.request(
      `${shared}/packing`,
      j.owner.token,
      movement(id, unpacked, inBag(b), 3),
      "POST",
    ),
  ]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
  const stock = {
    requestId: randomUUID(),
    kind: "correct",
    fields: { received: 2 },
    reason: "Two counted by mistake",
  };
  assert.equal(
    (
      await fixture.request(
        `${shared}/items/${id}/acquisition`,
        other.token,
        stock,
        "POST",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await fixture.request(
        `${shared}/items/${id}`,
        other.token,
        {
          requestId: randomUUID(),
          requiredQuantity: 2,
          reason: "Reduced requirement",
        },
        "PATCH",
      )
    ).status,
    422,
  );
  const snapshot = await fixture.request(shared, other.token);
  assert.equal(snapshot.data.items[0].packing.packed, 3);
  assert.equal(snapshot.data.bags[0].name, "Renamed group bag");
  assert.equal(snapshot.data.bags[0].weightNote, "19 kg");
  assert.equal(snapshot.data.bags[0].legs[0].needsReview, true);
  const used = visibility("trip");
  const path = `${j.family}/bags/${b}/visibility`;
  assert.equal(
    (await fixture.request(path, j.owner.token, used, "POST")).status,
    200,
  );
  await share(j, "bag", b, "family");
  const retry = await fixture.request(path, j.owner.token, used, "POST");
  assert.equal(
    retry.data.audience,
    "family",
    "an old sharing receipt must not republish a bag",
  );
  assert.equal(
    (
      await fixture.request(
        `${shared}/bags/${b}/state`,
        other.token,
        state,
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/members/${other.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal((await fixture.request(shared, other.token)).status, 404);
  assert.equal(
    (
      await fixture.request(
        `${shared}/items/${id}`,
        other.token,
        { requestId: randomUUID(), title: "After removal" },
        "PATCH",
      )
    ).status,
    404,
  );
});

test("racing visibility and packing serialize on current content and coordinator/trip-role revocation also denies old receipts", async () => {
  const j = await setup("sharing_visibility_race");
  const other = await admit(j, "sharing_visibility_other");
  const id = await item(j);
  const b = await bag(j, "Atomic bag");
  await receive(j, id);
  const publication = visibility("trip");
  const bagPath = `${j.family}/bags/${b}/visibility`;
  const race = await Promise.all([
    fixture.request(bagPath, j.owner.token, publication, "POST"),
    fixture.request(
      `${j.family}/packing`,
      j.owner.token,
      movement(id, unpacked, inBag(b)),
      "POST",
    ),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const shared = await fixture.request(`${j.trip}/shared`, other.token);
  assert.deepEqual(shared.data.items, []);
  if (shared.data.bags.length) {
    assert.equal(
      (await fixture.request(`${j.family}/packing`, j.owner.token)).data
        .items[0].packed,
      0,
    );
  } else {
    await fixture.request(
      `${j.family}/packing`,
      j.owner.token,
      { ...movement(id, inBag(b), unpacked), reason: "Prepare shared packing" },
      "POST",
    );
    assert.equal((await share(j, "bag", b)).status, 200);
  }
  await share(j, "entry", id);
  const second = await Promise.all([
    share(j, "entry", id, "family"),
    fixture.request(
      `${j.trip}/shared/packing`,
      other.token,
      movement(id, unpacked, inBag(b)),
      "POST",
    ),
  ]);
  assert.ok(second.some((r) => r.status === 200));
  assert.ok(
    second.every((r) => [200, 404, 409].includes(r.status)),
    fixture.logs(),
  );
  const canonical = await fixture.request(`${j.family}/packing`, j.owner.token);
  const visible = await fixture.request(`${j.trip}/shared`, other.token);
  assert.ok(
    canonical.data.items[0].packed === 0 || visible.data.items.length === 1,
  );
  await share(j, "entry", id);
  const edit = { requestId: randomUUID(), title: "Before downgrade" };
  const path = `${j.trip}/shared/items/${id}`;
  assert.equal(
    (await fixture.request(path, other.token, edit, "PATCH")).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/members/${other.id}`,
        j.owner.token,
        { role: "viewer" },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(path, other.token, edit, "PATCH")).status,
    403,
  );
  assert.equal(
    (await fixture.request(`${j.trip}/shared`, other.token)).data.items[0]
      .canEdit,
    false,
  );
  const coordinator = await admit(
    j,
    "sharing_next_coordinator",
    "member",
    "coordinator",
  );
  const request = visibility("trip");
  const itemPath = `${j.family}/checklist/entries/${id}/visibility`;
  assert.equal(
    (await fixture.request(itemPath, j.owner.token, request, "POST")).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/members/${j.owner.id}`,
        coordinator.token,
        { role: "editor" },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(itemPath, j.owner.token, request, "POST")).status,
    403,
  );
});
