import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { startFixture } from "./support/fixture";
let fixture: Awaited<ReturnType<typeof startFixture>>, pool: Pool;
before(
  async () => {
    fixture = await startFixture();
    pool = new Pool({ connectionString: fixture.databaseUrl });
  },
  { timeout: 120_000 },
);
after(async () => {
  await pool?.end();
  await fixture?.close();
});
async function member(name: string) {
  const token = await fixture.token(`user_${name}`, `${name}@example.test`);
  const saved = await fixture.request("/api/me", token, {
    firstName: "Test",
    lastName: name,
    username: name,
  });
  assert.equal(saved.status, 200, fixture.logs());
  return { token, id: saved.data.profile.id as string };
}
async function check(
  path: string,
  token: string,
  body?: unknown,
  method = "GET",
  status = 200,
) {
  const r = await fixture.request(path, token, body, method);
  assert.equal(r.status, status, JSON.stringify(r.data) + fixture.logs());
  return r.data;
}
test("organisers manage every family without durable grants; demotion removes derived access", async () => {
  const owner = await member("all_family_owner"),
    co = await member("all_family_co"),
    viewer = await member("all_family_viewer");
  const trip = await check(
    "/api/trips",
    owner.token,
    {
      name: "Organiser families",
      kind: "umrah",
      startDate: "2026-12-10",
      endDate: "2026-12-20",
      destinations: ["Makkah"],
      familyName: "Owner family",
    },
    "POST",
    201,
  );
  const base = `/api/trips/${trip.trip.id}`;
  await pool.query(
    "INSERT INTO trip_members(trip_id,member_id,role) VALUES($1,$2,'organizer'),($1,$3,'viewer')",
    [trip.trip.id, co.id, viewer.id],
  );
  const second = (
    await check(
      `${base}/families`,
      co.token,
      { name: "Second family", requestId: randomUUID() },
      "POST",
      201,
    )
  ).family;
  const detail = await check(base, owner.token);
  assert.equal(detail.families.length, 2);
  assert.ok(detail.families.every((f: any) => f.canEdit && f.canCoordinate));
  const path = `${base}/families/${second.id}`,
    list = `${path}/checklist`;
  await check(path, owner.token, { name: "Corrected family" }, "PATCH");
  const category = (
    await check(
      `${list}/categories`,
      owner.token,
      { name: "Person or category", requestId: randomUUID() },
      "POST",
      201,
    )
  ).category;
  const entry = (
    await check(
      `${list}/entries`,
      owner.token,
      {
        requestId: randomUUID(),
        kind: "item",
        categoryId: category.id,
        title: "Family item",
        requiredQuantity: 1,
        unit: "piece",
        beneficiaries: { kind: "family" },
        responsibleMemberId: owner.id,
      },
      "POST",
      201,
    )
  ).entry;
  const command = {
    requestId: randomUUID(),
    kind: "move",
    from: "remaining",
    to: "alreadyAvailable",
    quantity: 1,
    physicalConfirmed: true,
  };
  assert.equal(
    (
      await check(
        `${list}/entries/${entry.id}/acquisition`,
        owner.token,
        command,
        "POST",
      )
    ).entry.acquisition.available,
    1,
  );
  const task = (
    await check(
      `${list}/entries`,
      owner.token,
      {
        requestId: randomUUID(),
        kind: "task",
        categoryId: category.id,
        title: "Family task",
        taskStatus: "to_do",
        beneficiaries: { kind: "family" },
        responsibleMemberId: owner.id,
      },
      "POST",
      201,
    )
  ).entry;
  await check(
    `${list}/entries/${task.id}`,
    owner.token,
    { requestId: randomUUID(), taskStatus: "done" },
    "PATCH",
  );
  const traveler = (
    await check(
      `${path}/travelers`,
      owner.token,
      { requestId: randomUUID(), firstName: "Aisha", lastName: "Khan" },
      "POST",
      201,
    )
  ).traveler;
  await check(
    `${path}/travelers/${traveler.id}`,
    owner.token,
    { firstName: "Ayesha" },
    "PATCH",
  );
  await check(`${path}/packing?leg=outbound`, owner.token);
  const guide = await check(
    `${base}/guides`,
    co.token,
    {
      familyId: second.id,
      requestId: randomUUID(),
      kind: "text",
      title: "Private guidance",
      category: "Preparation",
      text: "Family guidance.",
    },
    "POST",
    201,
  );
  assert.equal((await check(`${base}/guides`, owner.token)).guides.length, 1);
  assert.ok(
    (await check(`${base}/guides/${guide.guide.id}`, owner.token)).guide
      .canEdit,
  );
  assert.ok(
    (await check(`${base}/guides/${guide.guide.id}/history`, owner.token))
      .versions.length,
  );
  assert.ok(
    (await check(`${base}/summary`, owner.token)).families.some(
      (f: any) => f.id === second.id,
    ),
  );
  assert.ok(
    (await check(`${base}/overview`, owner.token)).records.some(
      (r: any) => r.id === entry.id,
    ),
  );
  await check(
    `${base}/overview/activity?entryId=${entry.id}&leg=outbound`,
    owner.token,
  );
  await check(list, viewer.token, undefined, "GET", 404);
  await check(list, "invalid.signature.token", undefined, "GET", 401);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM family_members WHERE family_id=$1 AND member_id=$2",
        [second.id, owner.id],
      )
    ).rows[0].n,
    0,
  );
  await pool.query(
    "UPDATE trip_members SET role='member' WHERE trip_id=$1 AND member_id=$2",
    [trip.trip.id, owner.id],
  );
  assert.equal((await check(base, owner.token)).families.length, 1);
  await check(list, owner.token, undefined, "GET", 404);
  await check(
    `${base}/guides/${guide.guide.id}`,
    owner.token,
    undefined,
    "GET",
    404,
  );
  await check(
    `${list}/entries/${entry.id}/acquisition`,
    owner.token,
    command,
    "POST",
    404,
  );
  await pool.query(
    "UPDATE trip_members SET role='organizer' WHERE trip_id=$1 AND member_id=$2",
    [trip.trip.id, owner.id],
  );
  await check(list, owner.token);
  await pool.query(
    "DELETE FROM trip_members WHERE trip_id=$1 AND member_id=$2",
    [trip.trip.id, owner.id],
  );
  await check(list, owner.token, undefined, "GET", 404);
});
