import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";

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
async function trip(owner: { token: string }, kind = "umrah") {
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Family preparation",
      kind,
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Ahmed family",
    },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  const path = `/api/trips/${created.data.trip.id}`;
  const familyId = created.data.families[0].id as string;
  return {
    path,
    familyId,
    checklist: `${path}/families/${familyId}/checklist`,
  };
}
async function category(
  path: string,
  token: string,
  name = "Children and elders",
) {
  const saved = await fixture.request(
    `${path}/categories`,
    token,
    { name, requestId: randomUUID() },
    "POST",
  );
  assert.equal(saved.status, 201, fixture.logs());
  return saved.data.category;
}
async function admit(
  journey: Awaited<ReturnType<typeof trip>>,
  owner: Awaited<ReturnType<typeof member>>,
  target: Awaited<ReturnType<typeof member>>,
  roles: Record<string, string> = {},
) {
  const offered = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
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
  const accepted = await fixture.request(
    `/api/invitations/${offered.data.invitation.id}/accept`,
    target.token,
    {},
    "POST",
  );
  assert.equal(accepted.status, 200, fixture.logs());
}
function item(categoryId: string, memberId: string) {
  return {
    kind: "item",
    categoryId,
    title: "Shared charging adapters",
    requiredQuantity: 4,
    unit: "adapters",
    beneficiaries: { kind: "family" },
    responsibleMemberId: memberId,
    requestId: randomUUID(),
  };
}

test("four adapters distinguish physical availability from ordering and unchecked delivery", async () => {
  const owner = await member("acquisition_owner");
  const journey = await trip(owner);
  const group = await category(journey.checklist, owner.token);
  const created = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    { ...item(group.id, owner.id), priority: "essential" },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  const path = `${journey.checklist}/entries/${created.data.entry.id}`;
  for (const to of ["alreadyAvailable", "received", "ordered"]) {
    const changed = await fixture.request(
      `${path}/acquisition`,
      owner.token,
      {
        kind: "move",
        from: "remaining",
        to,
        quantity: 1,
        physicalConfirmed: to !== "ordered",
        requestId: randomUUID(),
      },
      "POST",
    );
    assert.equal(changed.status, 200, fixture.logs());
  }
  let read = await fixture.request(path, owner.token);
  assert.deepEqual(read.data.entry.acquisition, {
    remaining: 1,
    ordered: 1,
    delivered: 0,
    bought: 0,
    received: 1,
    alreadyAvailable: 1,
    stillToArrange: 1,
    awaitingReceipt: 1,
    available: 2,
    remainingToBeReady: 2,
    expectedDeliveryDate: null,
    notNeededReason: null,
  });
  const delivered = await fixture.request(
    `${path}/acquisition`,
    owner.token,
    {
      kind: "move",
      from: "ordered",
      to: "delivered",
      quantity: 1,
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(delivered.status, 200, fixture.logs());
  assert.equal(delivered.data.entry.acquisition.available, 2);
  assert.equal(delivered.data.entry.acquisition.awaitingReceipt, 1);
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        owner.token,
        {
          kind: "move",
          from: "delivered",
          to: "received",
          quantity: 1,
          requestId: randomUUID(),
        },
        "POST",
      )
    ).status,
    422,
  );
  const checked = await fixture.request(
    `${path}/acquisition`,
    owner.token,
    {
      kind: "move",
      from: "delivered",
      to: "received",
      quantity: 0.5,
      physicalConfirmed: true,
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(checked.status, 200, fixture.logs());
  assert.equal(checked.data.entry.acquisition.available, 2.5);
  assert.equal(checked.data.entry.acquisition.delivered, 0.5);
  await fixture.restartApi();
  read = await fixture.request(path, owner.token);
  assert.equal(read.data.entry.acquisition.available, 2.5);
  const events = (
    await fixture.request(`${journey.checklist}/history`, owner.token)
  ).data.history;
  assert.equal(
    events.filter((e: any) => e.entityId === created.data.entry.id).length,
    6,
  );
  assert.ok(
    events.every(
      (e: any) => e.actor.id === owner.id && Number.isFinite(Date.parse(e.at)),
    ),
  );
});

test("corrections and legacy requirement/removal writes enforce one active requirement and retain reasons", async () => {
  const owner = await member("correction_owner");
  const journey = await trip(owner);
  const group = await category(journey.checklist, owner.token);
  const created = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    {
      ...item(group.id, owner.id),
      requiredQuantity: 0.1 + 0.2,
      unit: "litres",
    },
    "POST",
  );
  assert.equal(created.status, 201);
  assert.equal(created.data.entry.requiredQuantity, 0.3);
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/entries`,
        owner.token,
        { ...item(group.id, owner.id), requiredQuantity: 0.0000000001 },
        "POST",
      )
    ).status,
    422,
  );
  const path = `${journey.checklist}/entries/${created.data.entry.id}`;
  const correct = (fields: object, reason = "Correct measured amounts") =>
    fixture.request(
      `${path}/acquisition`,
      owner.token,
      {
        kind: "correct",
        requestId: randomUUID(),
        fields,
        reason,
        physicalConfirmed: true,
      },
      "POST",
    );
  assert.equal(
    (await correct({ ordered: 0.1, received: 0.2 })).status,
    200,
    fixture.logs(),
  );
  let read = await fixture.request(path, owner.token);
  assert.equal(read.data.entry.acquisition.remaining, 0);
  assert.equal(read.data.entry.acquisition.remainingToBeReady, 0.1);
  for (const fields of [
    { ordered: -1 },
    { received: 0.0000000001 },
    { received: 0.2001 },
    { ordered: 0.2 },
    { requiredQuantity: 0.1 },
    { notNeededReason: "Plans changed" },
  ])
    assert.equal((await correct(fields)).status, 422);
  for (const fields of [
    { requiredQuantity: 0.2 },
    { requiredQuantity: 0.1, reason: "Fewer people" },
  ])
    assert.equal(
      (
        await fixture.request(
          path,
          owner.token,
          { ...fields, requestId: randomUUID() },
          "PATCH",
        )
      ).status,
      422,
    );
  assert.equal(
    (await fixture.request(path, owner.token, undefined, "DELETE")).status,
    422,
  );
  assert.equal(
    (await correct({ requiredQuantity: 0.2, ordered: 0 })).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        owner.token,
        {
          kind: "move",
          from: "received",
          to: "remaining",
          quantity: 0.1,
          reason: "Returned damaged amount",
          requestId: randomUUID(),
        },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (await correct({ notNeededReason: "No longer traveling", received: 0 }))
      .status,
    200,
  );
  read = await fixture.request(path, owner.token);
  assert.equal(read.data.entry.acquisition.remainingToBeReady, 0);
  assert.equal(read.data.entry.acquisition.available, 0);
  assert.equal(read.data.entry.requiredQuantity, 0.2);
  assert.equal(
    (await correct({ notNeededReason: null }, "Restore travel requirement"))
      .status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        path,
        owner.token,
        {
          requiredQuantity: 0.1,
          reason: "Smaller bottle",
          requestId: randomUUID(),
        },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        path,
        owner.token,
        { reason: "Duplicate entry", requestId: randomUUID() },
        "DELETE",
      )
    ).status,
    200,
  );
  const events = (
    await fixture.request(`${journey.checklist}/history`, owner.token)
  ).data.history;
  assert.ok(
    events.some(
      (e: any) => e.changes.reason?.after === "Returned damaged amount",
    ),
  );
  assert.ok(
    events.some(
      (e: any) => e.changes.notNeededReason?.after === "No longer traveling",
    ),
  );
  assert.ok(
    events.some(
      (e: any) =>
        e.action === "removed" && e.changes.reason?.after === "Duplicate entry",
    ),
  );
});

test("simultaneous receipts, metadata edits and lost-response retries preserve newer accepted work", async () => {
  const owner = await member("retry_owner"),
    editor = await member("retry_editor");
  const journey = await trip(owner);
  await admit(journey, owner, editor);
  const group = await category(journey.checklist, owner.token);
  const created = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    item(group.id, owner.id),
    "POST",
  );
  const path = `${journey.checklist}/entries/${created.data.entry.id}`;
  const command = {
    kind: "move",
    from: "remaining",
    to: "received",
    quantity: 1,
    physicalConfirmed: true,
    requestId: randomUUID(),
  };
  // Discard the committed HTTP response body: the caller has no parsed save result.
  const lost = await fetch(`${fixture.url}${path}/acquisition`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${owner.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  await lost.body!.cancel();
  const results = await Promise.all([
    fixture.request(`${path}/acquisition`, owner.token, command, "POST"),
    fixture.request(`${path}/acquisition`, owner.token, command, "POST"),
    fixture.request(
      path,
      editor.token,
      {
        title: "Adapters for our whole family",
        notes: "Keep the spare",
        requestId: randomUUID(),
      },
      "PATCH",
    ),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200, 200],
  );
  const corrected = {
    kind: "correct",
    fields: { received: 0.5 },
    reason: "Receipt corrected",
    requestId: randomUUID(),
  };
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        editor.token,
        corrected,
        "POST",
      )
    ).status,
    200,
  );
  const retried = await fixture.request(
    `${path}/acquisition`,
    owner.token,
    command,
    "POST",
  );
  assert.equal(retried.data.entry.acquisition.received, 0.5);
  assert.equal(retried.data.entry.title, "Adapters for our whole family");
  assert.equal(retried.data.entry.notes, "Keep the spare");
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        owner.token,
        { ...command, quantity: 2 },
        "POST",
      )
    ).status,
    409,
  );
  const patch = {
    requiredQuantity: 3,
    reason: "One fewer needed",
    requestId: randomUUID(),
  };
  assert.equal(
    (await fixture.request(path, owner.token, patch, "PATCH")).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        path,
        editor.token,
        { requiredQuantity: 5, requestId: randomUUID() },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(path, owner.token, patch, "PATCH")).data.entry
      .requiredQuantity,
    5,
  );
  // A fresh identifier with identical current fields is a no-op, not another audit event.
  const before = (
    await fixture.request(`${journey.checklist}/history`, owner.token)
  ).data.history;
  assert.equal(
    (
      await fixture.request(
        path,
        owner.token,
        {
          requiredQuantity: 5,
          reason: "Reviewed amount",
          requestId: randomUUID(),
        },
        "PATCH",
      )
    ).status,
    200,
  );
  const after = (
    await fixture.request(`${journey.checklist}/history`, owner.token)
  ).data.history;
  assert.equal(after.length, before.length);
  assert.equal(
    after.filter((e: any) => e.changes.received?.after === 1).length,
    1,
  );
  const contenders = await Promise.all(
    Array.from({ length: 6 }, () =>
      fixture.request(
        `${path}/acquisition`,
        editor.token,
        { ...command, quantity: 1, requestId: randomUUID() },
        "POST",
      ),
    ),
  );
  assert.equal(contenders.filter((r) => r.status === 200).length, 4);
  assert.equal(contenders.filter((r) => r.status === 422).length, 2);
  const final = (await fixture.request(path, owner.token)).data.entry;
  assert.equal(final.acquisition.received, 4.5);
  assert.equal(final.acquisition.remaining, 0.5);
});

test("shopping, expected delivery, overdue receipt and essential outstanding views identify the canonical item", async () => {
  const owner = await member("views_owner");
  const journey = await trip(owner);
  const group = await category(journey.checklist, owner.token);
  const created = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    { ...item(group.id, owner.id), priority: "essential" },
    "POST",
  );
  const path = `${journey.checklist}/entries/${created.data.entry.id}`;
  const saves = await Promise.all([
    fixture.request(
      `${path}/acquisition`,
      owner.token,
      {
        kind: "move",
        from: "remaining",
        to: "ordered",
        quantity: 2,
        requestId: randomUUID(),
      },
      "POST",
    ),
    fixture.request(
      `${path}/acquisition`,
      owner.token,
      {
        kind: "correct",
        fields: { expectedDeliveryDate: "2020-01-01" },
        requestId: randomUUID(),
      },
      "POST",
    ),
  ]);
  assert.deepEqual(
    saves.map((r) => r.status),
    [200, 200],
  );
  const views = await fixture.request(
    `${journey.checklist}/acquisition`,
    owner.token,
  );
  assert.equal(views.status, 200, fixture.logs());
  for (const view of [
    "shopping",
    "expectedDelivery",
    "overdueReceipt",
    "essentialOutstanding",
  ])
    assert.deepEqual(
      views.data[view].map((e: any) => e.id),
      [created.data.entry.id],
    );
  assert.equal(views.data.shopping[0].acquisition.stillToArrange, 2);
  assert.equal(views.data.expectedDelivery[0].acquisition.awaitingReceipt, 2);
  assert.equal(
    views.data.essentialOutstanding[0].acquisition.remainingToBeReady,
    4,
  );
  assert.equal(views.data.canEdit, true);
  assert.match(views.headers.get("cache-control")!, /no-store/);
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        owner.token,
        {
          kind: "correct",
          fields: { notNeededReason: "Trip canceled", ordered: 0 },
          requestId: randomUUID(),
        },
        "POST",
      )
    ).status,
    200,
  );
  const cleared = await fixture.request(
    `${journey.checklist}/acquisition`,
    owner.token,
  );
  for (const view of [
    "shopping",
    "expectedDelivery",
    "overdueReceipt",
    "essentialOutstanding",
  ])
    assert.deepEqual(cleared.data[view], []);
});

test("cancellation, rejected parcels and returned purchases become outstanding; concurrent requirement changes stay valid", async () => {
  const owner = await member("returns_owner");
  const journey = await trip(owner);
  const group = await category(journey.checklist, owner.token);
  const created = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    item(group.id, owner.id),
    "POST",
  );
  const path = `${journey.checklist}/entries/${created.data.entry.id}`;
  const move = (
    from: string,
    to: string,
    quantity: number,
    details: object = {},
  ) =>
    fixture.request(
      `${path}/acquisition`,
      owner.token,
      { kind: "move", from, to, quantity, requestId: randomUUID(), ...details },
      "POST",
    );
  for (const state of ["ordered", "delivered", "bought", "alreadyAvailable"]) {
    assert.equal(
      (await move("remaining", state, 1, { physicalConfirmed: true })).status,
      200,
    );
  }
  assert.equal((await move("bought", "remaining", 1)).status, 422);
  for (const [state, reason] of [
    ["ordered", "Order canceled"],
    ["delivered", "Parcel rejected"],
    ["bought", "Purchase returned"],
    ["alreadyAvailable", "Count corrected"],
  ])
    assert.equal((await move(state, "remaining", 1, { reason })).status, 200);
  assert.equal(
    (await fixture.request(path, owner.token)).data.entry.acquisition.remaining,
    4,
  );
  assert.equal((await move("remaining", "bought", 1)).status, 422);
  const results = await Promise.all([
    move("remaining", "received", 3, { physicalConfirmed: true }),
    fixture.request(
      path,
      owner.token,
      { requiredQuantity: 2, reason: "Smaller group", requestId: randomUUID() },
      "PATCH",
    ),
  ]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 422).length, 1);
  const read = (await fixture.request(path, owner.token)).data.entry;
  assert.ok(
    (read.requiredQuantity === 4 && read.acquisition.received === 3) ||
      (read.requiredQuantity === 2 && read.acquisition.received === 0),
  );
});

test("acquisition routes keep family privacy, viewer restrictions and revocation locks even on receipt retries", async () => {
  const owner = await member("private_owner"),
    editor = await member("private_editor"),
    viewer = await member("private_viewer"),
    organizer = await member("private_organizer");
  const journey = await trip(owner);
  await admit(journey, owner, editor);
  await admit(journey, owner, viewer, { familyRole: "viewer" });
  await admit(journey, owner, organizer, { tripRole: "organizer" });
  const familyMembers = `${journey.path}/families/${journey.familyId}/members`;
  assert.equal(
    (
      await fixture.request(
        `${familyMembers}/${organizer.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  const group = await category(journey.checklist, owner.token);
  const created = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    item(group.id, owner.id),
    "POST",
  );
  const path = `${journey.checklist}/entries/${created.data.entry.id}`;
  const command = {
    kind: "move",
    from: "remaining",
    to: "received",
    quantity: 1,
    physicalConfirmed: true,
    requestId: randomUUID(),
  };
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        viewer.token,
        command,
        "POST",
      )
    ).status,
    403,
  );
  assert.equal(
    (await fixture.request(`${journey.checklist}/acquisition`, viewer.token))
      .data.canEdit,
    false,
  );
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        organizer.token,
        command,
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (await fixture.request(`${journey.checklist}/acquisition`, organizer.token))
      .status,
    404,
  );
  assert.equal(
    (await fixture.request(`${path}/acquisition`, undefined, command, "POST"))
      .status,
    401,
  );
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        editor.token,
        command,
        "POST",
      )
    ).status,
    200,
  );
  const raceCommand = { ...command, requestId: randomUUID() };
  const [write, revoke] = await Promise.all([
    fixture.request(`${path}/acquisition`, editor.token, raceCommand, "POST"),
    fixture.request(
      `${familyMembers}/${editor.id}`,
      owner.token,
      undefined,
      "DELETE",
    ),
  ]);
  assert.ok([200, 404].includes(write.status));
  assert.equal(revoke.status, 200);
  assert.equal(
    (
      await fixture.request(
        `${path}/acquisition`,
        editor.token,
        command,
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (await fixture.request(path, owner.token)).data.entry.acquisition.received,
    write.status === 200 ? 2 : 1,
  );
  const task = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    {
      ...item(group.id, owner.id),
      kind: "task",
      requiredQuantity: null,
      unit: "",
      taskStatus: "to_do",
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(task.data.entry.acquisition, null);
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/entries/${task.data.entry.id}/acquisition`,
        owner.token,
        { ...command, requestId: randomUUID() },
        "POST",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/entries/${task.data.entry.id}`,
        owner.token,
        { taskStatus: "done" },
        "PATCH",
      )
    ).status,
    200,
  );
});
