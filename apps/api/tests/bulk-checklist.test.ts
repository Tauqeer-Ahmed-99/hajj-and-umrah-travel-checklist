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
async function setup(label: string) {
  const token = await fixture.token(
    `user_bulk_${label}`,
    `bulk_${label}@example.test`,
  );
  const profile = await fixture.request("/api/me", token, {
    firstName: "Bulk",
    lastName: "Test",
    username: `bulk_${label}`,
  });
  assert.equal(profile.status, 200);
  const trip = await fixture.request(
    "/api/trips",
    token,
    {
      name: "Bulk deletion",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Owned family",
    },
    "POST",
  );
  assert.equal(trip.status, 201);
  const base = `/api/trips/${trip.data.trip.id}`,
    family = `${base}/families/${trip.data.families[0].id}`,
    path = family + "/checklist";
  const category = async (name: string) => {
    const r = await fixture.request(
      path + "/categories",
      token,
      { name, requestId: randomUUID() },
      "POST",
    );
    assert.equal(r.status, 201);
    return r.data.category.id as string;
  };
  const entry = async (categoryId: string, kind = "task") => {
    const r = await fixture.request(
      path + "/entries",
      token,
      {
        categoryId,
        kind,
        title: kind + " " + randomUUID().slice(0, 6),
        beneficiaries: { kind: "family" },
        responsibleMemberId: profile.data.profile.id,
        ...(kind === "item"
          ? { requiredQuantity: 2, unit: "pieces" }
          : { taskStatus: "to_do" }),
        requestId: randomUUID(),
      },
      "POST",
    );
    assert.equal(r.status, 201);
    return r.data.entry.id as string;
  };
  return { token, base, family, path, category, entry };
}
const command = (entryIds: string[], categoryIds: string[] = []) => ({
  requestId: randomUUID(),
  entryIds,
  categoryIds,
  reason: "Remove selected preparation",
});
test("selected records and categories are deleted atomically, retain history and retry without duplicate events", async () => {
  const a = await setup("selected"),
    category = await a.category("Delete section"),
    empty = await a.category("Empty section"),
    kept = await a.category("Keep section");
  const item = await a.entry(category, "item"),
    task = await a.entry(category),
    remaining = await a.entry(kept);
  const body = command([item, task], [category, empty]);
  const [deleted, retried] = await Promise.all([
    fixture.request(a.path + "/bulk-removal", a.token, body, "POST"),
    fixture.request(a.path + "/bulk-removal", a.token, body, "POST"),
  ]);
  assert.equal(
    deleted.status,
    200,
    JSON.stringify(deleted.data) + fixture.logs().slice(-6000),
  );
  assert.equal(retried.status, 200);
  const read = await fixture.request(a.path, a.token);
  assert.deepEqual(
    read.data.entries.map((e: { id: string }) => e.id),
    [remaining],
  );
  assert.deepEqual(
    read.data.categories.map((e: { id: string }) => e.id),
    [kept],
  );
  const history = await fixture.request(a.path + "/history", a.token);
  const removed = history.data.history.filter(
    (e: { action: string }) => e.action === "removed",
  );
  assert.equal(removed.length, 4);
  assert.ok(removed.every((e: any) => e.changes.reason.after === body.reason));
  assert.equal(
    (
      await fixture.request(
        a.path + "/bulk-removal",
        a.token,
        { ...body, entryIds: [remaining] },
        "POST",
      )
    ).status,
    409,
  );
});
test("a new child after section selection prevents deletion of every selected record", async () => {
  const a = await setup("changed"),
    group = await a.category("Changed section"),
    first = await a.entry(group),
    body = command([first], [group]);
  const added = await a.entry(group);
  const r = await fixture.request(
    a.path + "/bulk-removal",
    a.token,
    body,
    "POST",
  );
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "category_changed");
  assert.equal((await fixture.request(a.path, a.token)).data.entries.length, 2);
  assert.equal(
    (await fixture.request(a.path + "/history", a.token)).data.history.filter(
      (e: any) => e.action === "removed",
    ).length,
    0,
  );
  assert.equal(
    (
      await fixture.request(
        a.path + "/bulk-removal",
        a.token,
        command([first, added], [group]),
        "POST",
      )
    ).status,
    200,
  );
});
test("foreign IDs, outsiders, duplicate IDs and empty selections cannot remove permitted records", async () => {
  const a = await setup("scope"),
    b = await setup("other"),
    group = await a.category("Keep"),
    item = await a.entry(group, "item"),
    foreign = await b.entry(await b.category("Private"));
  assert.equal(
    (
      await fixture.request(
        a.path + "/bulk-removal",
        b.token,
        command([item]),
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        a.path + "/bulk-removal",
        a.token,
        command([item, foreign]),
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        a.path + "/bulk-removal",
        a.token,
        command([item, item]),
        "POST",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await fixture.request(
        a.path + "/bulk-removal",
        a.token,
        command([]),
        "POST",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await fixture.request(
        a.path + "/bulk-removal",
        a.token,
        { ...command([item]), reason: "" },
        "POST",
      )
    ).status,
    422,
  );
  assert.equal((await fixture.request(a.path, a.token)).data.entries.length, 1);
});
test("an allocated item prevents the entire bulk delete until it is explicitly unpacked", async () => {
  const a = await setup("packed"),
    group = await a.category("Packing"),
    item = await a.entry(group, "item"),
    task = await a.entry(group);
  const traveler = await fixture.request(
    a.family + "/travelers",
    a.token,
    { requestId: randomUUID(), firstName: "Test", lastName: "Carrier" },
    "POST",
  );
  assert.equal(traveler.status, 201);
  const acquired = await fixture.request(
    a.path + `/entries/${item}/acquisition`,
    a.token,
    {
      requestId: randomUUID(),
      kind: "move",
      from: "remaining",
      to: "received",
      quantity: 2,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(acquired.status, 200);
  const move = {
    requestId: randomUUID(),
    kind: "move",
    leg: "outbound",
    entryId: item,
    from: { kind: "unpacked" },
    to: { kind: "traveler", id: traveler.data.traveler.id },
    quantity: 1,
    physicalConfirmed: true,
  };
  assert.equal(
    (await fixture.request(a.family + "/packing", a.token, move, "POST"))
      .status,
    200,
  );
  const body = command([item, task], [group]);
  const r = await fixture.request(
    a.path + "/bulk-removal",
    a.token,
    body,
    "POST",
  );
  assert.equal(r.status, 409);
  assert.equal(r.data.error.code, "packing_conflict");
  assert.equal((await fixture.request(a.path, a.token)).data.entries.length, 2);
  assert.equal(
    (
      await fixture.request(
        a.family + "/packing",
        a.token,
        {
          ...move,
          requestId: randomUUID(),
          from: move.to,
          to: move.from,
          reason: "Unpacked for deletion",
        },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(a.path + "/bulk-removal", a.token, body, "POST"))
      .status,
    200,
  );
});
test("return requirements prevent bulk removal until they are reconciled", async () => {
  const a = await setup("returning"),
    group = await a.category("Return"),
    item = await a.entry(group, "item"),
    task = await a.entry(group),
    body = command([item, task], [group]);
  assert.equal(
    (
      await fixture.request(
        a.family + "/return-preparation",
        a.token,
        { kind: "propose", requestId: randomUUID() },
        "POST",
      )
    ).status,
    200,
  );
  const denied = await fixture.request(
    a.path + "/bulk-removal",
    a.token,
    body,
    "POST",
  );
  assert.equal(denied.status, 409);
  assert.equal(denied.data.error.code, "return_conflict");
  assert.equal((await fixture.request(a.path, a.token)).data.entries.length, 2);
  assert.equal(
    (
      await fixture.request(
        a.family + "/return-preparation",
        a.token,
        {
          kind: "reconcile",
          requestId: randomUUID(),
          entryId: item,
          fields: { requiredQuantity: 0 },
          reason: "Not bringing this home",
          reviewConfirmed: true,
        },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(a.path + "/bulk-removal", a.token, body, "POST"))
      .status,
    200,
  );
});
test("a selection larger than an ordinary form is handled in one bulk request", async () => {
  const a = await setup("large");
  for (let i = 0; i < 12; i++)
    assert.equal(
      (
        await fixture.request(
          a.path + "/starter-copies",
          a.token,
          { kind: "umrah", requestId: randomUUID() },
          "POST",
        )
      ).status,
      201,
    );
  const current = (await fixture.request(a.path, a.token)).data;
  const body = command(
    current.entries.map((e: any) => e.id),
    current.categories.map((c: any) => c.id),
  );
  assert.ok(Buffer.byteLength(JSON.stringify(body)) > 8192);
  assert.equal(
    (await fixture.request(a.path + "/bulk-removal", a.token, body, "POST"))
      .status,
    200,
  );
  const after = (await fixture.request(a.path, a.token)).data;
  assert.equal(after.entries.length, 0);
  assert.equal(after.categories.length, 0);
});
