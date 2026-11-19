import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { startFixture } from "./support/fixture";
import {
  travelStepsResponse,
  travelRemindersResponse,
  tripUpdatesResponse,
  zonedInstant,
} from "@nmt/contracts";
let fixture: Awaited<ReturnType<typeof startFixture>>, pool: Pool;
before(
  async () => {
    fixture = await startFixture({}, { notifications: true });
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
async function setup(name: string) {
  const owner = await member(name);
  const s = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Travel steps",
      kind: "umrah",
      startDate: "2027-02-01",
      endDate: "2027-02-14",
      destinations: ["Makkah"],
      familyName: "Private family",
    },
    "POST",
  );
  assert.equal(s.status, 201, fixture.logs());
  const id = s.data.trip.id as string,
    family = s.data.families[0].id as string;
  return { owner, id, family, path: `/api/trips/${id}` };
}
const input = (
  mode = "train",
  leg = "outbound",
  time = "2027-02-01T00:00:00+05:30",
  zone = "Asia/Kolkata",
) => ({
  requestId: randomUUID(),
  mode,
  leg,
  title: `Board ${mode}`,
  startsAt: { dateTime: time, timeZone: zone },
});
async function check(
  path: string,
  token: string,
  body?: unknown,
  method = "POST",
  status = 200,
) {
  const r = await fixture.request(path, token, body, method);
  assert.equal(
    r.status,
    status,
    `${JSON.stringify(r.data)}\n${fixture.logs()}`,
  );
  return r.data;
}
test("ordered optional travel steps validate zones, persist after restart and make retries safe", async () => {
  const j = await setup("travel_owner"),
    path = `${j.path}/travel-steps`;
  assert.deepEqual((await fixture.request(path, j.owner.token)).data, {
    steps: [],
    canEdit: true,
    boardingEnabled: true,
  });
  const first = input(),
    saved = await check(path, j.owner.token, first, "POST", 201);
  assert.equal(
    (await check(path, j.owner.token, first, "POST", 201)).step.id,
    saved.step.id,
  );
  await check(path, j.owner.token, { ...first, title: "Changed" }, "POST", 409);
  for (const [mode, time] of [
    ["metro", "01:30"],
    ["arrival", "03:00"],
    ["flight", "07:50"],
  ])
    await check(
      path,
      j.owner.token,
      input(mode, "outbound", `2027-02-01T${time}:00+05:30`),
      "POST",
      201,
    );
  await check(
    path,
    j.owner.token,
    input("flight", "return", "2027-02-14T12:00:00+03:00", "Asia/Riyadh"),
    "POST",
    201,
  );
  await check(
    path,
    j.owner.token,
    input("train", "outbound", "2027-03-14T02:30:00-05:00", "America/New_York"),
    "POST",
    422,
  );
  let current = travelStepsResponse.parse(
    (await fixture.request(path, j.owner.token)).data,
  );
  assert.deepEqual(
    current.steps.filter((s) => s.leg === "outbound").map((s) => s.mode),
    ["train", "metro", "arrival", "flight"],
  );
  const ids = current.steps
    .filter((s) => s.leg === "outbound")
    .map((s) => s.id)
    .reverse();
  await check(
    `${path}/order`,
    j.owner.token,
    { leg: "outbound", stepIds: ids },
    "PUT",
  );
  const edit = { requestId: randomUUID(), title: "Early train" };
  await check(`${path}/${saved.step.id}`, j.owner.token, edit, "PATCH");
  await check(
    `${path}/${saved.step.id}`,
    j.owner.token,
    { requestId: randomUUID(), title: "Current train" },
    "PATCH",
  );
  assert.equal(
    (await check(`${path}/${saved.step.id}`, j.owner.token, edit, "PATCH")).step
      .title,
    "Current train",
  );
  await fixture.restartApi();
  current = travelStepsResponse.parse(
    (await fixture.request(path, j.owner.token)).data,
  );
  assert.deepEqual(
    current.steps.filter((s) => s.leg === "outbound").map((s) => s.id),
    ids,
  );
});
test("travel and tip endpoints verify JWTs, current membership, role, and crossed identifiers", async () => {
  const j = await setup("travel_permissions"),
    other = await setup("travel_other"),
    viewer = await member("travel_viewer");
  await pool.query(
    "INSERT INTO trip_members(trip_id,member_id,role) VALUES($1,$2,'viewer')",
    [j.id, viewer.id],
  );
  const saved = await check(
    `${j.path}/travel-steps`,
    j.owner.token,
    input(),
    "POST",
    201,
  );
  for (const endpoint of ["travel-steps", "travel-reminders", "updates"]) {
    assert.equal(
      (await fixture.request(`${j.path}/${endpoint}`, "invalid")).status,
      401,
    );
    assert.equal(
      (await fixture.request(`${j.path}/${endpoint}`, other.owner.token))
        .status,
      404,
    );
    assert.equal(
      (await fixture.request(`${j.path}/${endpoint}`, viewer.token)).status,
      200,
    );
  }
  await check(`${j.path}/travel-steps`, viewer.token, input(), "POST", 403);
  await check(
    `${other.path}/travel-steps/${saved.step.id}`,
    other.owner.token,
    { requestId: randomUUID(), title: "Crossed" },
    "PATCH",
    404,
  );
  await check(
    `${j.path}/tips`,
    viewer.token,
    { requestId: randomUUID(), title: "Tip", body: "No" },
    "POST",
    403,
  );
  await pool.query(
    "DELETE FROM trip_members WHERE trip_id=$1 AND member_id=$2",
    [j.id, viewer.id],
  );
  assert.equal(
    (await fixture.request(`${j.path}/travel-steps`, viewer.token)).status,
    404,
  );
});
test("six boarding offsets update safely and respect trip/global preferences and deletion", async () => {
  const j = await setup("travel_alerts");
  await check(
    "/api/notifications",
    j.owner.token,
    { deadlines: true },
    "PATCH",
  );
  const departure = zonedInstant(Date.now() + 86_400_000, "Asia/Kolkata");
  const saved = await check(
    `${j.path}/travel-steps`,
    j.owner.token,
    input("train", "outbound", departure.dateTime),
    "POST",
    201,
  );
  let result = travelRemindersResponse.parse(
    (await fixture.request(`${j.path}/travel-reminders`, j.owner.token)).data,
  );
  assert.equal(result.reminders.length, 6);
  for (const column of ["transport_offset_minutes", "transport_step_version"])
    await assert.rejects(
      pool.query(`UPDATE reminders SET ${column}=NULL WHERE id=$1`, [
        result.reminders[0].id,
      ]),
      { code: "23514" },
    );

  const start = Date.parse(saved.step.startsAt.dateTime);
  assert.deepEqual(
    result.reminders
      .map((r) => (start - Date.parse(r.dueAt.dateTime)) / 60000)
      .sort((a, b) => b - a),
    [60, 30, 15, 10, 5, 0],
  );
  assert.ok(
    result.reminders.every(
      (r) =>
        r.dueAt.timeZone === "Asia/Kolkata" && !r.dismissed && !r.needsReview,
    ),
  );
  assert.equal(
    (await fixture.request(`${j.path}/reminders`, j.owner.token)).data.reminders
      .length,
    0,
  );
  const before = new Map(result.reminders.map((r) => [r.id, r.version]));
  await check(
    `${j.path}/travel-steps/${saved.step.id}`,
    j.owner.token,
    {
      requestId: randomUUID(),
      title: "Corrected train name",
      notes: "Use platform 2",
    },
    "PATCH",
  );
  const unchanged = travelRemindersResponse.parse(
    (await fixture.request(`${j.path}/travel-reminders`, j.owner.token)).data,
  );
  assert.ok(
    unchanged.reminders.every((r) => r.version === before.get(r.id)),
    "Text corrections cannot replay boarding alerts",
  );

  await check(
    `${j.path}/travel-steps/${saved.step.id}`,
    j.owner.token,
    {
      requestId: randomUUID(),
      startsAt: {
        ...zonedInstant(
          Date.parse(departure.dateTime) + 3_600_000,
          "Asia/Kolkata",
        ),
      },
    },
    "PATCH",
  );
  result = travelRemindersResponse.parse(
    (await fixture.request(`${j.path}/travel-reminders`, j.owner.token)).data,
  );
  assert.ok(
    result.reminders.every(
      (r) => r.version > before.get(r.id)! && !r.needsReview,
    ),
  );
  await check(
    `${j.path}/travel-reminders`,
    j.owner.token,
    { boardingEnabled: false },
    "PATCH",
  );
  assert.ok(
    (
      await fixture.request(`${j.path}/travel-reminders`, j.owner.token)
    ).data.reminders.every((r: any) => r.dismissed),
  );
  await check(
    `${j.path}/travel-reminders`,
    j.owner.token,
    { boardingEnabled: true },
    "PATCH",
  );
  await check(
    "/api/notifications",
    j.owner.token,
    { deadlines: false },
    "PATCH",
  );
  assert.ok(
    (
      await fixture.request(`${j.path}/travel-reminders`, j.owner.token)
    ).data.reminders.every((r: any) => r.dismissed),
  );
  await check(
    `${j.path}/travel-steps/${saved.step.id}`,
    j.owner.token,
    undefined,
    "DELETE",
  );
  assert.equal(
    (await fixture.request(`${j.path}/travel-reminders`, j.owner.token)).data
      .reminders.length,
    0,
  );
  const dst = Date.parse("2027-11-07T01:30:00-05:00");
  assert.equal(
    zonedInstant(dst - 60 * 60000, "America/New_York").dateTime,
    "2027-11-07T01:30:00-04:00",
  );
});
test("explicit trip tips respect author/organizer authority and reject unsafe links", async () => {
  const j = await setup("tip_owner"),
    author = await member("tip_author"),
    reader = await member("tip_reader");
  await pool.query(
    "INSERT INTO trip_members(trip_id,member_id,role) VALUES($1,$2,'member'),($1,$3,'member')",
    [j.id, author.id, reader.id],
  );
  const body = {
    requestId: randomUUID(),
    title: "Packing cubes",
    body: "Keep chargers in a small pouch.",
    sourceUrl: "https://example.com/cubes",
  };
  const a = await check(`${j.path}/tips`, author.token, body, "POST", 201),
    b = await check(`${j.path}/tips`, author.token, body, "POST", 201);
  assert.equal(a.id, b.id);
  let feed = tripUpdatesResponse.parse(
    (await fixture.request(`${j.path}/updates`, reader.token)).data,
  );
  assert.equal(feed.tips.length, 1);
  assert.equal(feed.tips[0].canEdit, false);
  assert.equal(feed.tips[0].canRemove, false);
  await check(
    `${j.path}/tips/${a.id}`,
    reader.token,
    { requestId: randomUUID(), body: "Not mine" },
    "PATCH",
    404,
  );
  await check(
    `${j.path}/tips/${a.id}`,
    author.token,
    { requestId: randomUUID(), body: "Clear pouch." },
    "PATCH",
  );
  await check(
    `${j.path}/tips`,
    author.token,
    { ...body, requestId: randomUUID(), sourceUrl: "javascript:alert(1)" },
    "POST",
    422,
  );
  await check(`${j.path}/tips/${a.id}`, j.owner.token, undefined, "DELETE");
  feed = tripUpdatesResponse.parse(
    (await fixture.request(`${j.path}/updates`, reader.token)).data,
  );
  assert.equal(feed.tips.length, 0);
});
test("packing automatically announces readiness once and withdraws stale claims without private contents", async () => {
  const j = await setup("ready_owner"),
    reader = await member("ready_reader");
  await pool.query(
    "INSERT INTO trip_members(trip_id,member_id,role) VALUES($1,$2,'member')",
    [j.id, reader.id],
  );
  await check(
    "/api/notifications",
    reader.token,
    { tripChanges: true },
    "PATCH",
  );
  await check(
    "/api/notifications/device",
    reader.token,
    {
      deviceId: randomUUID(),
      tripIds: [j.id],
      token: `ExpoPushToken[${randomUUID()}]`,
      localSchedules: [],
    },
    "PUT",
  );
  const beforePush = fixture.pushes.length;
  const f = `${j.path}/families/${j.family}`;
  assert.deepEqual(
    (await fixture.request(`${j.path}/updates`, reader.token)).data.readiness,
    [],
  );
  const traveler = (
    await check(
      `${f}/travelers`,
      j.owner.token,
      { requestId: randomUUID(), firstName: "Private", lastName: "Traveler" },
      "POST",
      201,
    )
  ).traveler;
  const cat = (
    await check(
      `${f}/checklist/categories`,
      j.owner.token,
      { requestId: randomUUID(), name: "Private category" },
      "POST",
      201,
    )
  ).category;
  const entry = (
    await check(
      `${f}/checklist/entries`,
      j.owner.token,
      {
        requestId: randomUUID(),
        categoryId: cat.id,
        kind: "item",
        title: "PRIVATE-MEDICINE",
        responsibleMemberId: j.owner.id,
        requiredQuantity: 1,
        unit: "pack",
        beneficiaries: { kind: "family" },
        leg: "outbound",
      },
      "POST",
      201,
    )
  ).entry;
  await pool.query(
    "UPDATE checklist_entries SET already_available=1 WHERE id=$1",
    [entry.id],
  );
  const bags = await check(
    `${f}/bags`,
    j.owner.token,
    {
      requestId: randomUUID(),
      name: "PRIVATE-BAG",
      type: "Suitcase",
      carrierTravelerId: traveler.id,
      identifyingNote: "",
      weightNote: "",
      allowanceNote: "",
    },
    "POST",
    201,
  );
  const bag = bags.bags[0];
  await pool.query(
    "INSERT INTO packing_allocations(family_id,entry_id,leg,bag_id,quantity) VALUES($1,$2,'outbound',$3,1)",
    [j.family, entry.id, bag.id],
  );
  await check(
    `${f}/bags/${bag.id}/state`,
    j.owner.token,
    { requestId: randomUUID(), leg: "outbound", status: "ready" },
    "POST",
  );
  const until = Date.now() + 8000;
  let feed: any;
  do {
    feed = (await fixture.request(`${j.path}/updates`, reader.token)).data;
    if (feed.readiness?.[0]?.ready) break;
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() < until);
  assert.equal(feed.readiness?.[0]?.ready, true, fixture.logs());
  assert.ok(!JSON.stringify(feed).includes("PRIVATE-"));
  assert.equal(feed.readiness.length, 1);
  while (fixture.pushes.length === beforePush && Date.now() < until)
    await new Promise((r) => setTimeout(r, 50));
  assert.equal(fixture.pushes.length, beforePush + 1, fixture.logs());
  assert.ok(
    JSON.stringify(fixture.pushes.at(-1)).includes(
      "A family is packed and ready",
    ),
  );
  assert.ok(!JSON.stringify(fixture.pushes.at(-1)).includes("PRIVATE-"));
  const count = async () =>
    (
      await pool.query(
        "SELECT * FROM notification_events WHERE source_key LIKE $1 AND recipient_id=$2",
        [`family-ready:${j.family}:%`, reader.id],
      )
    ).rowCount;
  assert.equal(await count(), 1);
  await check(
    `${f}/bags/${bag.id}/state`,
    j.owner.token,
    { requestId: randomUUID(), leg: "outbound", status: "ready" },
    "POST",
  );
  assert.equal(await count(), 1);
  await pool.query(
    "UPDATE bag_legs SET needs_review=true WHERE bag_id=$1 AND leg='outbound'",
    [bag.id],
  );
  feed = (await fixture.request(`${j.path}/updates`, reader.token)).data;
  assert.equal(feed.readiness[0].ready, false);
  assert.equal(
    (await fixture.request(`${f}/packing`, reader.token)).status,
    404,
  );
  const late = await member("late_ready_reader");
  await pool.query(
    "INSERT INTO trip_members(trip_id,member_id,role) VALUES($1,$2,'member')",
    [j.id, late.id],
  );
  await check("/api/notifications", late.token, { tripChanges: true }, "PATCH");
  const deviceId = randomUUID();
  await check(
    "/api/notifications/device",
    late.token,
    {
      deviceId,
      tripIds: [j.id],
      token: `ExpoPushToken[${randomUUID()}]`,
      localSchedules: [],
    },
    "PUT",
  );
  await pool.query(
    "INSERT INTO notification_events(source_key,recipient_id,trip_id,kind) SELECT source_key,$1,trip_id,kind FROM notification_events WHERE recipient_id=$2 AND source_key LIKE $3 LIMIT 1",
    [late.id, reader.id, `family-ready:${j.family}:%`],
  );
  await check(
    "/api/notifications/dispatch",
    "fixture-dispatch-only",
    {},
    "POST",
  );
  assert.equal(
    fixture.pushes.length,
    beforePush + 1,
    "Withdrawn readiness must not dispatch",
  );
  const status = (await fixture.request("/api/notifications", late.token)).data;
  assert.equal(
    status.deliveries.length,
    0,
    "Stale derived status is hidden from notification history",
  );
});

test("automatic trip updates reach more than one dispatch batch without duplicate retries", async () => {
  const j = await setup("tip_many_owner"),
    before = fixture.pushes.length;
  for (let i = 0; i < 12; i++) {
    const target = await member(`tip_many_${i}`);
    await pool.query(
      "INSERT INTO trip_members(trip_id,member_id,role) VALUES($1,$2,'member')",
      [j.id, target.id],
    );
    await check(
      "/api/notifications",
      target.token,
      { tripChanges: true },
      "PATCH",
    );
    await check(
      "/api/notifications/device",
      target.token,
      {
        deviceId: randomUUID(),
        tripIds: [j.id],
        token: `ExpoPushToken[${randomUUID()}]`,
        localSchedules: [],
      },
      "PUT",
    );
  }
  const body = {
    requestId: randomUUID(),
    title: "A useful tip",
    body: "TRIP-ONLY-CONTENT",
  };
  await check(`${j.path}/tips`, j.owner.token, body, "POST", 201);
  const until = Date.now() + 12_000;
  while (fixture.pushes.length < before + 12 && Date.now() < until)
    await new Promise((r) => setTimeout(r, 50));
  assert.equal(fixture.pushes.length, before + 12, fixture.logs());
  assert.ok(
    fixture.pushes
      .slice(before)
      .every(
        (message) => !JSON.stringify(message).includes("TRIP-ONLY-CONTENT"),
      ),
  );
  await check(`${j.path}/tips`, j.owner.token, body, "POST", 201);
  assert.equal(fixture.pushes.length, before + 12);
});
