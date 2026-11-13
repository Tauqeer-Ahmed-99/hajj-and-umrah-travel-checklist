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

test("a family saves a child's requirement with a separate responsible account and reopens it after API restart", async () => {
  const owner = await member("checklist_owner");
  const journey = await trip(owner);
  const child = await fixture.request(
    `${journey.path}/families/${journey.familyId}/travelers`,
    owner.token,
    { firstName: "Aisha", lastName: "Ahmed" },
    "POST",
  );
  assert.equal(child.status, 201);
  const group = await category(journey.checklist, owner.token);
  const input = {
    kind: "item",
    categoryId: group.id,
    title: "Aisha's spare clothing",
    requiredQuantity: 3,
    unit: "sets",
    beneficiaries: { kind: "travelers", travelerIds: [child.data.traveler.id] },
    responsibleMemberId: owner.id,
    priority: "essential",
    dueDate: "2026-11-18",
    notes: "Choose comfortable sets",
    leg: "both",
    source: "Family preparation note",
    lastReviewedOn: "2026-11-14",
    requestId: randomUUID(),
  };
  const saved = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    input,
    "POST",
  );
  assert.equal(saved.status, 201, fixture.logs());
  const { requestId, ...expected } = input;
  assert.deepEqual(saved.data.entry, {
    ...expected,
    id: saved.data.entry.id,
    familyId: journey.familyId,
    taskStatus: null,
  });
  await fixture.restartApi();
  const reopened = await fixture.request(journey.checklist, owner.token);
  assert.equal(reopened.status, 200, fixture.logs());
  assert.deepEqual(reopened.data.entries, [saved.data.entry]);
  assert.equal(reopened.data.categories[0].name, "Children and elders");
  assert.equal(reopened.data.canEdit, true);
  assert.equal(reopened.headers.get("cache-control"), "private, no-store");
  assert.match(reopened.headers.get("vary") ?? "", /Authorization/i);
  assert.ok(!JSON.stringify(reopened.data).includes("@example.test"));
});

test("non-packing tasks progress independently of stock and retain server actor/time history", async () => {
  const owner = await member("task_owner");
  const journey = await trip(owner);
  const group = await category(
    journey.checklist,
    owner.token,
    "Travel documents",
  );
  const saved = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    {
      kind: "task",
      categoryId: group.id,
      title: "Discuss meeting plan",
      beneficiaries: { kind: "family" },
      responsibleMemberId: owner.id,
      taskStatus: "to_do",
      leg: "both",
    },
    "POST",
  );
  assert.equal(saved.status, 201, fixture.logs());
  const path = `${journey.checklist}/entries/${saved.data.entry.id}`;
  for (const taskStatus of ["in_progress", "done", "not_needed", "to_do"]) {
    const changed = await fixture.request(
      path,
      owner.token,
      { taskStatus },
      "PATCH",
    );
    assert.equal(changed.status, 200, fixture.logs());
    assert.equal(changed.data.entry.taskStatus, taskStatus);
    assert.equal(changed.data.entry.requiredQuantity, null);
    assert.equal(changed.data.entry.unit, "");
    assert.equal(changed.data.entry.title, "Discuss meeting plan");
    assert.ok(!("packed" in changed.data.entry));
  }
  const read = await fixture.request(path, owner.token);
  assert.equal(read.data.entry.id, saved.data.entry.id);
  const history = await fixture.request(
    `${journey.checklist}/history`,
    owner.token,
  );
  assert.equal(history.status, 200, fixture.logs());
  const events = history.data.history.filter(
    (event: any) => event.entityId === saved.data.entry.id,
  );
  assert.equal(events.length, 5);
  assert.deepEqual(
    events.map((event: any) => event.action),
    ["updated", "updated", "updated", "updated", "created"],
  );
  assert.deepEqual(events[0].changes, {
    taskStatus: { before: "not_needed", after: "to_do" },
  });
  assert.deepEqual(events[0].actor, {
    id: owner.id,
    firstName: "Sana",
    lastName: "Ahmed",
    username: "task_owner",
  });
  assert.ok(
    events.every((event: any) => Number.isFinite(Date.parse(event.at))),
  );
  assert.ok(!JSON.stringify(history.data).includes("@example.test"));
});

test("Hajj and Umrah starter copies are independent editable preparation prompts with safe retry receipts", async () => {
  const owner = await member("starter_owner");
  for (const kind of ["hajj", "umrah"]) {
    const journey = await trip(owner, kind);
    const input = { kind, requestId: randomUUID() };
    const copies = await Promise.all(
      [1, 2].map(() =>
        fixture.request(
          `${journey.checklist}/starter-copies`,
          owner.token,
          input,
          "POST",
        ),
      ),
    );
    assert.equal(copies[0].status, 201, fixture.logs());
    assert.deepEqual(copies[0].data, copies[1].data);
    const initial = await fixture.request(journey.checklist, owner.token);
    assert.equal(initial.data.categories.length, 10);
    assert.equal(initial.data.entries.length, 10);
    assert.ok(
      initial.data.categories.some(
        (category: any) => category.name === "Return purchases",
      ),
    );
    assert.ok(
      initial.data.entries.every(
        (entry: any) =>
          entry.responsibleMemberId === owner.id &&
          entry.source === "" &&
          entry.lastReviewedOn === null,
      ),
    );
    const entry = initial.data.entries.find(
      (entry: any) => entry.kind === "item",
    );
    const changed = await fixture.request(
      `${journey.checklist}/entries/${entry.id}`,
      owner.token,
      {
        title: "Our family's chosen supplies",
        requiredQuantity: 2.5,
        unit: "litres",
        source: "Our booking guidance",
        lastReviewedOn: "2026-11-14",
      },
      "PATCH",
    );
    assert.equal(changed.status, 200);
    const group = initial.data.categories[0];
    assert.equal(
      (
        await fixture.request(
          `${journey.checklist}/categories/${group.id}`,
          owner.token,
          { name: "Our own category" },
          "PATCH",
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await fixture.request(
          `${journey.checklist}/starter-copies`,
          owner.token,
          input,
          "POST",
        )
      ).status,
      201,
    );
    const reopened = await fixture.request(journey.checklist, owner.token);
    assert.equal(
      reopened.data.entries.find((item: any) => item.id === entry.id).title,
      "Our family's chosen supplies",
    );
    assert.equal(
      reopened.data.categories.find((item: any) => item.id === group.id).name,
      "Our own category",
    );
    assert.equal(
      (
        await fixture.request(
          `${journey.checklist}/starter-copies`,
          owner.token,
          { ...input, kind: kind === "hajj" ? "umrah" : "hajj" },
          "POST",
        )
      ).status,
      409,
    );
    const again = await fixture.request(
      `${journey.checklist}/starter-copies`,
      owner.token,
      { kind, requestId: randomUUID() },
      "POST",
    );
    assert.equal(again.status, 201);
    assert.notEqual(again.data.copyId, copies[0].data.copyId);
    assert.equal(
      (await fixture.request(journey.checklist, owner.token)).data.entries
        .length,
      20,
    );
  }
});

test("reassignment and concurrent field edits preserve one item; removal keeps history and never recreates a retried save", async () => {
  const owner = await member("edit_owner"),
    editor = await member("edit_helper");
  const journey = await trip(owner);
  await admit(journey, owner, editor);
  const group = await category(journey.checklist, owner.token);
  const input = item(group.id, owner.id);
  const saves = await Promise.all(
    [1, 2].map(() =>
      fixture.request(
        `${journey.checklist}/entries`,
        owner.token,
        input,
        "POST",
      ),
    ),
  );
  assert.equal(saves[0].status, 201);
  assert.deepEqual(saves[0].data, saves[1].data);
  const path = `${journey.checklist}/entries/${saves[0].data.entry.id}`;
  const changes = await Promise.all([
    fixture.request(path, owner.token, { requiredQuantity: 6 }, "PATCH"),
    fixture.request(
      path,
      editor.token,
      {
        title: "One shared adapter requirement",
        responsibleMemberId: editor.id,
      },
      "PATCH",
    ),
  ]);
  assert.deepEqual(
    changes.map((change) => change.status),
    [200, 200],
  );
  let read = await fixture.request(path, owner.token);
  assert.equal(read.data.entry.requiredQuantity, 6);
  assert.equal(read.data.entry.title, "One shared adapter requirement");
  assert.equal(read.data.entry.responsibleMemberId, editor.id);
  assert.equal(
    (await fixture.request(journey.checklist, owner.token)).data.entries.length,
    1,
  );
  await fixture.request(path, owner.token, { priority: "high" }, "PATCH");
  await fixture.request(path, editor.token, { priority: "essential" }, "PATCH");
  read = await fixture.request(path, owner.token);
  assert.equal(read.data.entry.priority, "essential");
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/categories/${group.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    409,
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await fixture.request(path, owner.token, undefined, "DELETE")).status,
      200,
      fixture.logs(),
    );
  assert.equal((await fixture.request(path, owner.token)).status, 404);
  assert.equal(
    (await fixture.request(journey.checklist, owner.token)).data.entries.length,
    0,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/entries`,
        owner.token,
        input,
        "POST",
      )
    ).status,
    410,
  );
  const history = (
    await fixture.request(`${journey.checklist}/history`, owner.token)
  ).data.history;
  assert.equal(
    history.filter(
      (event: any) =>
        event.entityId === saves[0].data.entry.id && event.action === "removed",
    ).length,
    1,
  );
  assert.ok(
    history.some(
      (event: any) =>
        event.actor.id === editor.id &&
        event.changes.responsibleMemberId?.after === editor.id,
    ),
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/categories/${group.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(journey.checklist, owner.token)).data.categories
      .length,
    0,
  );
});

test("every checklist read and write uses explicit family grants, including viewers, organizers, revoked members and crossed IDs", async () => {
  const owner = await member("access_owner"),
    viewer = await member("access_viewer"),
    organizer = await member("access_organizer"),
    outsider = await member("access_outsider");
  const journey = await trip(owner);
  await admit(journey, owner, viewer, {
    tripRole: "viewer",
    familyRole: "viewer",
  });
  await admit(journey, owner, organizer, {
    tripRole: "organizer",
    familyRole: "editor",
  });
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/families/${journey.familyId}/members/${organizer.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  const group = await category(
    journey.checklist,
    owner.token,
    "Private category",
  );
  const input = item(group.id, owner.id);
  const saved = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    input,
    "POST",
  );
  const entryPath = `${journey.checklist}/entries/${saved.data.entry.id}`;
  const writes = [
    [`${journey.checklist}/categories`, { name: "No" }, "POST"],
    [`${journey.checklist}/categories/${group.id}`, { name: "No" }, "PATCH"],
    [`${journey.checklist}/categories/${group.id}`, undefined, "DELETE"],
    [`${journey.checklist}/entries`, input, "POST"],
    [entryPath, { notes: "No" }, "PATCH"],
    [entryPath, undefined, "DELETE"],
    [`${journey.checklist}/starter-copies`, { kind: "umrah" }, "POST"],
  ] as const;
  for (const actor of [organizer, outsider]) {
    for (const path of [
      journey.checklist,
      entryPath,
      `${journey.checklist}/history`,
    ]) {
      const denied = await fixture.request(path, actor.token);
      assert.equal(denied.status, 404);
      assert.ok(!JSON.stringify(denied.data).includes("Private category"));
    }
    for (const [path, body, method] of writes)
      assert.equal(
        (await fixture.request(path, actor.token, body, method)).status,
        404,
      );
  }
  for (const path of [
    journey.checklist,
    entryPath,
    `${journey.checklist}/history`,
  ])
    assert.equal((await fixture.request(path, viewer.token)).status, 200);
  assert.equal(
    (await fixture.request(journey.checklist, viewer.token)).data.canEdit,
    false,
  );
  for (const [path, body, method] of writes)
    assert.equal(
      (await fixture.request(path, viewer.token, body, method)).status,
      403,
    );
  const other = await trip(owner);
  assert.equal(
    (
      await fixture.request(
        `${other.checklist}/entries/${saved.data.entry.id}`,
        owner.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${other.path}/families/${journey.familyId}/checklist`,
        owner.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/families/${journey.familyId}/members/${viewer.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(journey.checklist, viewer.token)).status,
    404,
  );
  assert.equal(
    (await fixture.request(`${journey.checklist}/history`, viewer.token))
      .status,
    404,
  );
  assert.equal((await fixture.request(journey.checklist)).status, 401);
  const incomplete = await fixture.token(
    "user_checklist_incomplete",
    "incomplete@example.test",
  );
  assert.equal(
    (await fixture.request(journey.checklist, incomplete)).status,
    403,
  );
  fixture.revoke("sess_user_access_owner");
  assert.equal((await fixture.request(entryPath, owner.token)).status, 401);
});

test("beneficiaries stay in the owning family, references are validated, and invalid partial edits preserve the accepted record", async () => {
  const owner = await member("valid_owner"),
    unrelated = await member("valid_unrelated");
  const journey = await trip(owner),
    other = await trip(owner);
  const group = await category(journey.checklist, owner.token);
  const otherGroup = await category(other.checklist, owner.token);
  const travelers: string[] = [];
  for (const firstName of ["Aisha", "Omar"]) {
    const child = await fixture.request(
      `${journey.path}/families/${journey.familyId}/travelers`,
      owner.token,
      { firstName, lastName: "Ahmed" },
      "POST",
    );
    travelers.push(child.data.traveler.id);
  }
  const foreign = await fixture.request(
    `${other.path}/families/${other.familyId}/travelers`,
    owner.token,
    { firstName: "Private", lastName: "Traveler" },
    "POST",
  );
  const input = {
    ...item(group.id, owner.id),
    beneficiaries: { kind: "travelers", travelerIds: travelers },
  };
  const saved = await fixture.request(
    `${journey.checklist}/entries`,
    owner.token,
    input,
    "POST",
  );
  assert.equal(saved.status, 201);
  assert.deepEqual(saved.data.entry.beneficiaries, {
    kind: "travelers",
    travelerIds: travelers,
  });
  const path = `${journey.checklist}/entries/${saved.data.entry.id}`;
  for (const patch of [
    {},
    { requiredQuantity: 0 },
    { requiredQuantity: -1 },
    { requiredQuantity: 1.0001 },
    { requiredQuantity: 1000001 },
    { requiredQuantity: null },
    { unit: " " },
    { taskStatus: "done" },
    { title: " " },
    { dueDate: "2026-02-30" },
    { leg: "departed" },
    { priority: "urgent" },
    { lastReviewedOn: "yesterday" },
    { packed: true },
    { actor: owner.id },
    { categoryId: otherGroup.id },
    { responsibleMemberId: unrelated.id },
    { beneficiaries: { kind: "travelers", travelerIds: [] } },
    {
      beneficiaries: {
        kind: "travelers",
        travelerIds: [travelers[0], travelers[0]],
      },
    },
    {
      beneficiaries: {
        kind: "travelers",
        travelerIds: [foreign.data.traveler.id],
      },
    },
  ])
    assert.equal(
      (await fixture.request(path, owner.token, patch, "PATCH")).status,
      422,
      JSON.stringify(patch),
    );
  assert.deepEqual((await fixture.request(path, owner.token)).data, saved.data);
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/entries`,
        owner.token,
        { ...input, title: "Conflicting retry" },
        "POST",
      )
    ).status,
    409,
  );
  const task = {
    kind: "task",
    categoryId: group.id,
    title: "Call hotel",
    beneficiaries: { kind: "family" },
    responsibleMemberId: owner.id,
    taskStatus: "to_do",
  };
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/entries`,
        owner.token,
        { ...task, requiredQuantity: 1, unit: "calls" },
        "POST",
      )
    ).status,
    422,
  );
  const changed = await fixture.request(
    path,
    owner.token,
    {
      beneficiaries: { kind: "family" },
      dueDate: null,
      lastReviewedOn: null,
      notes: "Our family shares one record",
      leg: "return",
    },
    "PATCH",
  );
  assert.equal(changed.status, 200);
  assert.equal(changed.data.entry.requiredQuantity, 4);
  assert.equal(changed.data.entry.leg, "return");
});

test("an editor's accepted write serializes against family revocation and all subsequent access is denied", async () => {
  const owner = await member("race_owner"),
    editor = await member("race_editor");
  const journey = await trip(owner);
  await admit(journey, owner, editor);
  const group = await category(journey.checklist, owner.token);
  const input = item(group.id, owner.id);
  const saved = await fixture.request(
    `${journey.checklist}/entries`,
    editor.token,
    input,
    "POST",
  );
  assert.equal(saved.status, 201);
  const path = `${journey.checklist}/entries/${saved.data.entry.id}`;
  const [write, revoke] = await Promise.all([
    fixture.request(
      path,
      editor.token,
      { notes: "Accepted before removal" },
      "PATCH",
    ),
    fixture.request(
      `${journey.path}/families/${journey.familyId}/members/${editor.id}`,
      owner.token,
      undefined,
      "DELETE",
    ),
  ]);
  assert.ok([200, 404].includes(write.status), fixture.logs());
  assert.equal(revoke.status, 200);
  assert.equal(
    (await fixture.request(path, owner.token)).data.entry.notes,
    write.status === 200 ? "Accepted before removal" : "",
  );
  for (const endpoint of [
    journey.checklist,
    path,
    `${journey.checklist}/history`,
  ])
    assert.equal((await fixture.request(endpoint, editor.token)).status, 404);
  assert.equal(
    (
      await fixture.request(
        `${journey.checklist}/entries`,
        editor.token,
        input,
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        path,
        editor.token,
        { notes: "After removal" },
        "PATCH",
      )
    ).status,
    404,
  );
});
