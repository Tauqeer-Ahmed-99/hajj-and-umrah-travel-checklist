import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFixture } from "./support/fixture";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

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

async function member(id: string) {
  const token = await fixture.token(`user_${id}`, `${id}@example.test`);
  const saved = await fixture.request("/api/me", token, {
    firstName: "Sana",
    lastName: "Ahmed",
    username: id,
  });
  assert.equal(saved.status, 200, fixture.logs());
  return { token, id: saved.data.profile.id as string };
}
const umrah = {
  name: "November Umrah",
  kind: "umrah",
  startDate: "2026-11-20",
  endDate: "2026-12-04",
  destinations: ["Makkah", "Madinah"],
  familyName: "Ahmed family",
};

test("a completed member creates and reopens a private trip with organizer and initial family coordinator authority", async () => {
  const owner = await member("trip_owner");
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    umrah,
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  assert.deepEqual(
    { ...created.data.trip, id: "stable" },
    {
      id: "stable",
      name: "November Umrah",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah", "Madinah"],
      role: "organizer",
    },
  );
  assert.equal(created.data.families.length, 1);
  assert.deepEqual(
    { ...created.data.families[0], id: "family", tripId: "trip" },
    {
      id: "family",
      tripId: "trip",
      name: "Ahmed family",
      role: "coordinator",
      canEdit: true,
      canCoordinate: true,
    },
  );
  await fixture.restartApi();
  const restored = await fixture.request(
    `/api/trips/${created.data.trip.id}`,
    owner.token,
  );
  assert.equal(restored.status, 200, fixture.logs());
  assert.deepEqual(restored.data, created.data);
  const listed = await fixture.request("/api/trips", owner.token);
  assert.deepEqual(listed.data, { trips: [created.data.trip] });
  const linkedSession = await fixture.token(
    "user_trip_owner",
    "trip_owner@example.test",
    { sessionId: "sess_trip_linked", strategy: "google_one_tap" },
  );
  assert.deepEqual(
    (await fixture.request(`/api/trips/${created.data.trip.id}`, linkedSession))
      .data,
    created.data,
  );
  assert.equal(restored.headers.get("cache-control"), "private, no-store");
  assert.ok(
    restored.headers.get("vary")?.toLowerCase().includes("authorization"),
  );
});

test("an organizer adds another family group without replacing the initial family", async () => {
  const owner = await member("more_families");
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    umrah,
    "POST",
  );
  const path = `/api/trips/${created.data.trip.id}`;
  const added = await fixture.request(
    `${path}/families`,
    owner.token,
    { name: "Khan family" },
    "POST",
  );
  assert.equal(added.status, 201, fixture.logs());
  assert.equal(added.data.family.name, "Khan family");
  assert.equal(added.data.family.role, "coordinator");
  const reopened = await fixture.request(path, owner.token);
  assert.deepEqual(
    reopened.data.families.map((family: { name: string }) => family.name),
    ["Ahmed family", "Khan family"],
  );
});

test("a coordinator saves a dependent traveler without creating an account and reopens the roster after restart", async () => {
  const owner = await member("dependent_owner");
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    umrah,
    "POST",
  );
  const family = created.data.families[0];
  const path = `/api/trips/${created.data.trip.id}/families/${family.id}/travelers`;
  const saved = await fixture.request(
    path,
    owner.token,
    { firstName: "Aisha", lastName: "Ahmed" },
    "POST",
  );
  assert.equal(saved.status, 201, fixture.logs());
  assert.deepEqual(
    { ...saved.data.traveler, id: "traveler", familyId: "family" },
    {
      id: "traveler",
      familyId: "family",
      firstName: "Aisha",
      lastName: "Ahmed",
    },
  );
  await fixture.restartApi();
  const restored = await fixture.request(path, owner.token);
  assert.equal(restored.status, 200, fixture.logs());
  assert.deepEqual(restored.data, { travelers: [saved.data.traveler] });
});

test("incomplete profiles and unrelated or revoked sessions cannot discover private trips or rosters", async () => {
  const owner = await member("isolation_owner");
  const outsider = await member("isolation_other");
  const incomplete = await fixture.token(
    "user_incomplete_trip",
    "incomplete@example.test",
  );
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    umrah,
    "POST",
  );
  const tripPath = `/api/trips/${created.data.trip.id}`;
  const rosterPath = `${tripPath}/families/${created.data.families[0].id}/travelers`;
  assert.deepEqual((await fixture.request("/api/trips", outsider.token)).data, {
    trips: [],
  });
  for (const path of [tripPath, rosterPath, "/api/trips/not-a-uuid"]) {
    const denied = await fixture.request(path, outsider.token);
    assert.equal(denied.status, 404);
    assert.ok(!JSON.stringify(denied.data).includes("Ahmed"));
  }
  for (const path of ["/api/trips", tripPath, rosterPath]) {
    assert.equal((await fixture.request(path)).status, 401);
    const denied = await fixture.request(path, incomplete);
    assert.equal(denied.status, 403);
    assert.equal(denied.data.error.code, "profile_incomplete");
  }
  assert.equal(
    (await fixture.request("/api/trips", incomplete, umrah, "POST")).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${tripPath}/families`,
        outsider.token,
        { name: "Intruder" },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        rosterPath,
        outsider.token,
        { firstName: "Intruder", lastName: "Person" },
        "POST",
      )
    ).status,
    404,
  );
  fixture.revoke("sess_user_isolation_owner");
  assert.equal((await fixture.request(tripPath, owner.token)).status, 401);
  assert.equal(
    (
      await fixture.request(
        rosterPath,
        owner.token,
        { firstName: "Revoked", lastName: "Person" },
        "POST",
      )
    ).status,
    401,
  );
});

// Until #5 supplies invitation acceptance, seed only membership preconditions in
// real PostgreSQL. All observations and permission decisions stay at HTTP.
async function access(
  tripId: string,
  memberId: string,
  role: string,
  familyId?: string,
  familyRole?: string,
) {
  const pool = new Pool({ connectionString: fixture.databaseUrl });
  try {
    await pool.query(
      "INSERT INTO trip_members (trip_id, member_id, role) VALUES ($1,$2,$3) ON CONFLICT (trip_id, member_id) DO UPDATE SET role = EXCLUDED.role",
      [tripId, memberId, role],
    );
    if (familyId)
      await pool.query(
        "INSERT INTO family_members (trip_id, family_id, member_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT (family_id, member_id) DO UPDATE SET role = EXCLUDED.role",
        [tripId, familyId, memberId, familyRole],
      );
  } finally {
    await pool.end();
  }
}

test("organizing a trip never grants access to another family's private roster; members and viewers stay scoped", async () => {
  const owner = await member("scope_owner");
  const other = await member("scope_other");
  const viewer = await member("scope_viewer");
  const editor = await member("scope_editor");
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    umrah,
    "POST",
  );
  const tripId = created.data.trip.id;
  const familyId = created.data.families[0].id;
  const path = `/api/trips/${tripId}`;
  await access(tripId, other.id, "organizer");
  const otherFamily = await fixture.request(
    `${path}/families`,
    other.token,
    { name: "Private Khan family" },
    "POST",
  );
  const otherRoster = `${path}/families/${otherFamily.data.family.id}/travelers`;
  assert.equal(
    (
      await fixture.request(
        otherRoster,
        other.token,
        { firstName: "Yusuf", lastName: "Khan" },
        "POST",
      )
    ).status,
    201,
  );
  assert.deepEqual(
    (await fixture.request(path, owner.token)).data.families.map(
      (f: { id: string }) => f.id,
    ),
    [familyId],
  );
  assert.equal((await fixture.request(otherRoster, owner.token)).status, 404);
  assert.equal(
    (
      await fixture.request(
        otherRoster,
        owner.token,
        { firstName: "Hidden", lastName: "Person" },
        "POST",
      )
    ).status,
    404,
  );
  await access(tripId, viewer.id, "viewer", familyId, "viewer");
  await access(tripId, editor.id, "member", familyId, "editor");
  const roster = `${path}/families/${familyId}/travelers`;
  for (const actor of [viewer, editor]) {
    assert.equal((await fixture.request(roster, actor.token)).status, 200);
    assert.equal(
      (
        await fixture.request(
          `${path}/families`,
          actor.token,
          { name: "Forbidden" },
          "POST",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await fixture.request(
          roster,
          actor.token,
          { firstName: "Forbidden", lastName: "Traveler" },
          "POST",
        )
      ).status,
      403,
    );
  }
  const view = (await fixture.request(path, viewer.token)).data.families[0];
  assert.equal(view.canEdit, false);
  assert.equal(view.canCoordinate, false);
  const edit = (await fixture.request(path, editor.token)).data.families[0];
  assert.equal(edit.canEdit, true);
  assert.equal(edit.canCoordinate, false);
  // A trip-level viewer cannot gain write authority from an inconsistent grant.
  await access(tripId, viewer.id, "viewer", familyId, "coordinator");
  assert.equal(
    (
      await fixture.request(
        roster,
        viewer.token,
        { firstName: "Still", lastName: "Forbidden" },
        "POST",
      )
    ).status,
    403,
  );
  const secondTrip = await fixture.request(
    "/api/trips",
    owner.token,
    { ...umrah, kind: "hajj", name: "Hajj 2027" },
    "POST",
  );
  assert.equal(secondTrip.status, 201);
  assert.equal(
    (
      await fixture.request(
        `/api/trips/${secondTrip.data.trip.id}/families/${familyId}/travelers`,
        owner.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (await fixture.request("/api/trips", owner.token)).data.trips.length,
    2,
  );
});

test("uncertain create retries with the same request ID create one trip, one family and one traveler", async () => {
  const owner = await member("retry_trip_owner");
  const input = { ...umrah, requestId: randomUUID() };
  const first = await fixture.request("/api/trips", owner.token, input, "POST");
  assert.equal(first.status, 201, fixture.logs());
  const retry = await fixture.request("/api/trips", owner.token, input, "POST");
  assert.deepEqual(retry.data, first.data);
  assert.equal(
    (await fixture.request("/api/trips", owner.token)).data.trips.length,
    1,
  );
  const familyInput = { name: "Retry family", requestId: randomUUID() };
  const familyPath = `/api/trips/${first.data.trip.id}/families`;
  const family = await fixture.request(
    familyPath,
    owner.token,
    familyInput,
    "POST",
  );
  assert.equal(family.status, 201);
  assert.deepEqual(
    (await fixture.request(familyPath, owner.token, familyInput, "POST")).data,
    family.data,
  );
  const travelerPath = `${familyPath}/${family.data.family.id}/travelers`;
  const travelerInput = {
    firstName: "Aisha",
    lastName: "Ahmed",
    requestId: randomUUID(),
  };
  const outcomes = await Promise.all([
    fixture.request(travelerPath, owner.token, travelerInput, "POST"),
    fixture.request(travelerPath, owner.token, travelerInput, "POST"),
  ]);
  assert.deepEqual(
    outcomes.map((r) => r.status),
    [201, 201],
  );
  assert.deepEqual(outcomes[0].data, outcomes[1].data);
  assert.equal(
    (await fixture.request(travelerPath, owner.token)).data.travelers.length,
    1,
  );
  const conflict = await fixture.request(
    "/api/trips",
    owner.token,
    { ...input, name: "Changed after an uncertain response" },
    "POST",
  );
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, "request_conflict");
  assert.equal(
    (await fixture.request(`/api/trips/${first.data.trip.id}`, owner.token))
      .data.trip.name,
    "November Umrah",
  );
});

test("invalid dates, empty destinations, authority spoofing and invalid traveler details never persist", async () => {
  const owner = await member("trip_validation");
  for (const input of [
    { ...umrah, endDate: "2026-11-01" },
    { ...umrah, startDate: "2026-02-30" },
    { ...umrah, destinations: [] },
    { ...umrah, destinations: [" "] },
    { ...umrah, familyName: " " },
    { ...umrah, kind: "holiday" },
    { ...umrah, role: "organizer", memberId: owner.id },
  ])
    assert.equal(
      (await fixture.request("/api/trips", owner.token, input, "POST")).status,
      422,
    );
  assert.deepEqual((await fixture.request("/api/trips", owner.token)).data, {
    trips: [],
  });
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    umrah,
    "POST",
  );
  const path = `/api/trips/${created.data.trip.id}/families/${created.data.families[0].id}/travelers`;
  for (const input of [
    { firstName: " ", lastName: "Ahmed" },
    { firstName: "Aisha", lastName: "Ahmed", memberId: owner.id },
    { firstName: "A".repeat(81), lastName: "Ahmed" },
  ])
    assert.equal(
      (await fixture.request(path, owner.token, input, "POST")).status,
      422,
    );
  assert.deepEqual((await fixture.request(path, owner.token)).data, {
    travelers: [],
  });
});
