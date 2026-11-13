import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";

let fixture: Awaited<ReturnType<typeof startFixture>>;
before(
  async () => {
    fixture = await startFixture({}, { notifications: true });
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
async function trip(owner: { token: string }) {
  const saved = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Private family journey",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Family",
    },
    "POST",
  );
  assert.equal(saved.status, 201, fixture.logs());
  return {
    path: `/api/trips/${saved.data.trip.id}`,
    familyId: saved.data.families[0].id as string,
  };
}
const dueAt = {
  dateTime: "2026-11-20T09:00:00+03:00",
  timeZone: "Asia/Riyadh",
};

test("owned reminders retain explicit zones and categories through restart; creation retries do not duplicate records", async () => {
  const owner = await member("reminder_owner");
  const journey = await trip(owner);
  const path = `${journey.path}/reminders`;
  const input = {
    requestId: randomUUID(),
    category: "departure_preparation",
    title: "Check travel documents",
    ownerMemberId: owner.id,
    dueAt,
  };
  const outcomes = await Promise.all([
    fixture.request(path, owner.token, input, "POST"),
    fixture.request(path, owner.token, input, "POST"),
  ]);
  assert.deepEqual(
    outcomes.map((r) => r.status),
    [201, 201],
    fixture.logs(),
  );
  assert.deepEqual(outcomes[0].data, outcomes[1].data);
  for (const category of [
    "assignment",
    "expected_delivery",
    "return_packing",
  ]) {
    assert.equal(
      (
        await fixture.request(
          path,
          owner.token,
          { ...input, requestId: randomUUID(), category },
          "POST",
        )
      ).status,
      201,
    );
  }
  assert.equal(
    (
      await fixture.request(
        path,
        owner.token,
        { ...input, title: "Changed" },
        "POST",
      )
    ).status,
    409,
  );
  await fixture.restartApi();
  const reopened = await fixture.request(path, owner.token);
  assert.equal(reopened.data.reminders.length, 4);
  assert.deepEqual(reopened.data.reminders[0].dueAt, dueAt);
  assert.equal(reopened.data.reminders[0].ownerMemberId, owner.id);
  assert.equal(reopened.headers.get("cache-control"), "private, no-store");
});

test("a reviewed reschedule receipt survives a lost response without clearing a later trip review", async () => {
  const owner = await member("review_receipt");
  const journey = await trip(owner);
  const created = await fixture.request(
    `${journey.path}/reminders`,
    owner.token,
    {
      requestId: randomUUID(),
      category: "departure_preparation",
      title: "Check departure",
      ownerMemberId: owner.id,
      dueAt,
    },
    "POST",
  );
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { phase: "during_stay" },
    "PATCH",
  );
  const current = (
    await fixture.request(`${journey.path}/reminders`, owner.token)
  ).data.reminders[0];
  const patch = {
    requestId: randomUUID(),
    reviewedVersion: current.version,
    dueAt: { dateTime: "2026-12-01T09:00:00+03:00", timeZone: "Asia/Riyadh" },
  };
  const endpoint = `${journey.path}/reminders/${created.data.reminder.id}`;
  const accepted = await fixture.request(endpoint, owner.token, patch, "PATCH");
  assert.equal(accepted.status, 200);
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { phase: "preparing_to_return" },
    "PATCH",
  );
  const retried = await fixture.request(endpoint, owner.token, patch, "PATCH");
  assert.equal(retried.status, 200);
  assert.equal(retried.data.reminder.needsReview, true);
  assert.equal(
    (
      await fixture.request(
        endpoint,
        owner.token,
        { ...patch, title: "Changed retry" },
        "PATCH",
      )
    ).status,
    409,
  );
});

test("dismiss and reschedule are safe repeated partial changes; itinerary changes require versioned review", async () => {
  const owner = await member("reminder_edits");
  const journey = await trip(owner);
  const path = `${journey.path}/reminders`;
  const created = await fixture.request(
    path,
    owner.token,
    {
      requestId: randomUUID(),
      category: "return_packing",
      title: "Review return belongings",
      ownerMemberId: owner.id,
      dueAt,
    },
    "POST",
  );
  const id = created.data.reminder.id;
  const endpoint = `${path}/${id}`;
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await fixture.request(
          endpoint,
          owner.token,
          { dismissed: true },
          "PATCH",
        )
      ).status,
      200,
    );
  assert.equal(
    (await fixture.request(path, owner.token)).data.reminders[0].dismissed,
    true,
  );
  const changed = {
    dateTime: "2026-12-03T18:00:00+05:30",
    timeZone: "Asia/Kolkata",
  };
  await fixture.request(
    endpoint,
    owner.token,
    { dueAt: changed, dismissed: false },
    "PATCH",
  );
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { phase: "preparing_to_return" },
    "PATCH",
  );
  const review = (await fixture.request(path, owner.token)).data.reminders[0];
  assert.equal(review.needsReview, true);
  assert.deepEqual(review.dueAt, changed);
  assert.equal(
    (
      await fixture.request(
        endpoint,
        owner.token,
        { reviewedVersion: review.version - 1 },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await fixture.request(
        endpoint,
        owner.token,
        { reviewedVersion: review.version },
        "PATCH",
      )
    ).data.reminder.needsReview,
    false,
  );
  const version = (await fixture.request(path, owner.token)).data.reminders[0]
    .version;
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { phase: "preparing_to_return" },
    "PATCH",
  );
  assert.equal(
    (await fixture.request(path, owner.token)).data.reminders[0].version,
    version,
  );
  await Promise.all([
    fixture.request(
      endpoint,
      owner.token,
      { title: "Check return plan" },
      "PATCH",
    ),
    fixture.request(endpoint, owner.token, { dueAt }, "PATCH"),
  ]);
  const saved = (await fixture.request(path, owner.token)).data.reminders[0];
  assert.equal(saved.title, "Check return plan");
  assert.deepEqual(saved.dueAt, dueAt);
  for (const input of [
    {},
    { ownerMemberId: randomUUID() },
    {
      dueAt: {
        dateTime: "2026-03-08T02:30:00-05:00",
        timeZone: "America/New_York",
      },
    },
    {
      dueAt: {
        dateTime: "2026-11-20T09:00:00+03:00",
        timeZone: "Asia/Kolkata",
      },
    },
  ]) {
    assert.equal(
      (await fixture.request(endpoint, owner.token, input, "PATCH")).status,
      422,
    );
  }
});

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
  );
}
test("private references, current owners and viewer restrictions apply again after membership removal", async () => {
  const owner = await member("reminder_private");
  const viewer = await member("reminder_viewer");
  const outsider = await member("reminder_outsider");
  const journey = await trip(owner);
  await admit(journey, owner, viewer, {
    tripRole: "viewer",
    familyRole: "viewer",
  });
  const path = `${journey.path}/reminders`;
  const input = {
    requestId: randomUUID(),
    category: "assignment",
    title: "Private preparation",
    ownerMemberId: viewer.id,
    familyId: journey.familyId,
    dueAt,
  };
  assert.equal(
    (
      await fixture.request(
        path,
        viewer.token,
        { ...input, ownerMemberId: owner.id },
        "POST",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        path,
        owner.token,
        { ...input, ownerMemberId: outsider.id },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal((await fixture.request(path, outsider.token)).status, 404);
  const created = await fixture.request(path, owner.token, input, "POST");
  assert.equal(created.status, 201);
  assert.equal(
    (
      await fixture.request(
        `${path}/${created.data.reminder.id}`,
        viewer.token,
        { dismissed: true },
        "PATCH",
      )
    ).status,
    200,
  );
  await fixture.request(
    `${journey.path}/families/${journey.familyId}/members/${viewer.id}`,
    owner.token,
    undefined,
    "DELETE",
  );
  assert.deepEqual(
    (await fixture.request(path, viewer.token)).data.reminders,
    [],
  );
  assert.equal(
    (await fixture.request(path, owner.token, input, "POST")).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${path}/${created.data.reminder.id}`,
        viewer.token,
        { dismissed: false },
        "PATCH",
      )
    ).status,
    404,
  );
  assert.equal((await fixture.request(path, undefined)).status, 401);
  fixture.revoke("sess_user_reminder_private");
  assert.equal((await fixture.request(path, owner.token)).status, 401);
});

test("important accepted assignments and trip changes dispatch according to preferences without private payloads or retry duplicates", async () => {
  const owner = await member("notify_owner");
  const target = await member("notify_target");
  const journey = await trip(owner);
  await admit(journey, owner, target);
  const deviceId = randomUUID();
  const registration = {
    deviceId,
    tripIds: [journey.path.split("/").at(-1)],
    token: `ExpoPushToken[${randomUUID()}]`,
    localSchedules: [],
  };
  assert.equal(
    (
      await fixture.request(
        "/api/notifications/device",
        target.token,
        registration,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        "/api/notifications",
        target.token,
        { assignments: true, deadlines: true, tripChanges: true },
        "PATCH",
      )
    ).status,
    200,
  );
  const checklist = `${journey.path}/families/${journey.familyId}/checklist`;
  const category = await fixture.request(
    `${checklist}/categories`,
    owner.token,
    { name: "Private documents", requestId: randomUUID() },
    "POST",
  );
  const input = {
    requestId: randomUUID(),
    categoryId: category.data.category.id,
    kind: "task",
    requiredQuantity: null,
    unit: "",
    taskStatus: "to_do",
    title: "SECRET passport details",
    responsibleMemberId: target.id,
    beneficiaries: { kind: "family" },
  };
  const created = await fixture.request(
    `${checklist}/entries`,
    owner.token,
    input,
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  await fixture.request(`${checklist}/entries`, owner.token, input, "POST");
  const drain = async () => {
    const result = await fixture.request(
      "/api/notifications/dispatch",
      "fixture-dispatch-only",
      {},
      "POST",
    );
    assert.equal(result.status, 200, fixture.logs());
  };
  await drain();
  assert.equal(fixture.pushes.length, 1);
  assert.deepEqual(fixture.pushes[0], {
    to: registration.token,
    title: "NMT Travel",
    body: "An important assignment needs your attention. Open NMT Travel.",
    channelId: "travel",
    ttl: 3600,
  });
  await fixture.request(
    `${checklist}/entries/${created.data.entry.id}`,
    owner.token,
    { notes: "routine note" },
    "PATCH",
  );
  await drain();
  assert.equal(fixture.pushes.length, 1);
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { meetingPoint: "SECRET hotel lobby" },
    "PATCH",
  );
  await drain();
  assert.equal(fixture.pushes.length, 2);
  assert.ok(!JSON.stringify(fixture.pushes).includes("SECRET"));
  await fixture.request(
    "/api/notifications",
    target.token,
    { tripChanges: false },
    "PATCH",
  );
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { meetingPoint: "Other lobby" },
    "PATCH",
  );
  await drain();
  assert.equal(fixture.pushes.length, 2);
  fixture.pushOutcome("unknown");
  const reminder = await fixture.request(
    `${journey.path}/reminders`,
    target.token,
    {
      requestId: randomUUID(),
      category: "expected_delivery",
      title: "Private delivery",
      ownerMemberId: target.id,
      dueAt: { dateTime: "2026-11-01T09:00:00+03:00", timeZone: "Asia/Riyadh" },
    },
    "POST",
  );
  assert.equal(reminder.status, 201);
  await drain();
  await drain();
  assert.equal(fixture.pushes.length, 3);
  const status = await fixture.request("/api/notifications", target.token);
  assert.ok(
    status.data.deliveries.some(
      (d: { state: string }) => d.state === "unknown",
    ),
  );
  assert.ok(!JSON.stringify(status.data).includes(registration.token));
  await fixture.restartApi();
  await drain();
  assert.equal(fixture.pushes.length, 3);
  fixture.pushOutcome("ok");
});

test("acknowledged native schedules suppress fallback pushes and registrations cannot claim another member's reminder", async () => {
  const owner = await member("native_deadline");
  const outsider = await member("native_outsider");
  const journey = await trip(owner);
  const count = fixture.pushes.length;
  const created = await fixture.request(
    `${journey.path}/reminders`,
    owner.token,
    {
      requestId: randomUUID(),
      category: "assignment",
      title: "Deadline",
      ownerMemberId: owner.id,
      dueAt: { dateTime: "2026-11-01T09:00:00+03:00", timeZone: "Asia/Riyadh" },
    },
    "POST",
  );
  const registration = {
    deviceId: randomUUID(),
    token: `ExpoPushToken[${randomUUID()}]`,
    tripIds: [journey.path.split("/").at(-1)],
    localSchedules: [
      { id: created.data.reminder.id, version: created.data.reminder.version },
    ],
  };
  assert.equal(
    (
      await fixture.request(
        "/api/notifications/device",
        outsider.token,
        registration,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        "/api/notifications/device",
        owner.token,
        registration,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        "/api/notifications/device",
        owner.token,
        registration,
      )
    ).status,
    200,
  );
  await fixture.request(
    "/api/notifications",
    owner.token,
    { deadlines: true },
    "PATCH",
  );
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await fixture.request(
          "/api/notifications/dispatch",
          "fixture-dispatch-only",
          {},
          "POST",
        )
      ).status,
      200,
    );
  assert.equal(fixture.pushes.length, count);
  assert.ok(
    (
      await fixture.request("/api/notifications", owner.token)
    ).data.deliveries.some((d: { state: string }) => d.state === "suppressed"),
  );
  const invalid = await fixture.request(
    "/api/notifications/device",
    owner.token,
    { ...registration, localSchedules: [{ id: randomUUID(), version: 1 }] },
  );
  assert.equal(invalid.status, 404);
  assert.equal(
    (
      await fixture.request(
        "/api/notifications/dispatch",
        owner.token,
        {},
        "POST",
      )
    ).status,
    401,
  );
});

test("queued private assignments respect family revocation and dispatch rejects ended Clerk sessions", async () => {
  const owner = await member("dispatch_owner");
  const target = await member("dispatch_target");
  const journey = await trip(owner);
  await admit(journey, owner, target);
  const before = fixture.pushes.length;
  const registration = {
    deviceId: randomUUID(),
    token: `ExpoPushToken[${randomUUID()}]`,
    tripIds: [] as string[],
    localSchedules: [],
  };
  await fixture.request(
    "/api/notifications/device",
    target.token,
    registration,
  );
  await fixture.request(
    "/api/notifications",
    target.token,
    { assignments: true, deadlines: true, tripChanges: true },
    "PATCH",
  );
  const checklist = `${journey.path}/families/${journey.familyId}/checklist`;
  const category = await fixture.request(
    `${checklist}/categories`,
    owner.token,
    { name: "Private", requestId: randomUUID() },
    "POST",
  );
  const entry = await fixture.request(
    `${checklist}/entries`,
    owner.token,
    {
      categoryId: category.data.category.id,
      kind: "task",
      title: "Family only",
      taskStatus: "to_do",
      responsibleMemberId: target.id,
      beneficiaries: { kind: "family" },
    },
    "POST",
  );
  assert.equal(entry.status, 201);
  await fixture.request(
    `${journey.path}/families/${journey.familyId}/members/${target.id}`,
    owner.token,
    undefined,
    "DELETE",
  );
  assert.equal(
    (
      await fixture.request("/api/notifications/device", target.token, {
        ...registration,
        tripIds: [journey.path.split("/").at(-1)!],
      })
    ).status,
    200,
  );
  await fixture.request(
    "/api/notifications/dispatch",
    "fixture-dispatch-only",
    {},
    "POST",
  );
  assert.equal(fixture.pushes.length, before);
  assert.deepEqual(
    (await fixture.request("/api/notifications", target.token)).data.deliveries,
    [],
  );
  await fixture.request(
    "/api/notifications/device",
    target.token,
    registration,
  );
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { meetingPoint: "New terminal" },
    "PATCH",
  );
  await fixture.request("/api/notifications/device", target.token, {
    ...registration,
    tripIds: [journey.path.split("/").at(-1)!],
  });
  fixture.revoke("sess_user_dispatch_target");
  await fixture.request(
    "/api/notifications/dispatch",
    "fixture-dispatch-only",
    {},
    "POST",
  );
  assert.equal(fixture.pushes.length, before);
  assert.equal(
    (
      await fixture.request(
        "/api/notifications/device",
        target.token,
        registration,
      )
    ).status,
    401,
  );
});

test("an owned delivery reminder can reference another responsible member's item and accepted expected-date changes notify its assignee", async () => {
  const owner = await member("delivery_owner");
  const target = await member("delivery_assignee");
  const journey = await trip(owner);
  await admit(journey, owner, target);
  const before = fixture.pushes.length;
  const checklist = `${journey.path}/families/${journey.familyId}/checklist`;
  const category = await fixture.request(
    `${checklist}/categories`,
    owner.token,
    { name: "Delivery", requestId: randomUUID() },
    "POST",
  );
  const item = await fixture.request(
    `${checklist}/entries`,
    owner.token,
    {
      kind: "item",
      title: "Private shared adapters",
      categoryId: category.data.category.id,
      requiredQuantity: 2,
      unit: "adapters",
      responsibleMemberId: target.id,
      beneficiaries: { kind: "family" },
    },
    "POST",
  );
  assert.equal(item.status, 201);
  for (const actor of [owner, target]) {
    assert.equal(
      (
        await fixture.request("/api/notifications/device", actor.token, {
          deviceId: randomUUID(),
          token: `ExpoPushToken[${randomUUID()}]`,
          tripIds: [journey.path.split("/").at(-1)],
          localSchedules: [],
        })
      ).status,
      200,
    );
    await fixture.request(
      "/api/notifications",
      actor.token,
      { deadlines: true },
      "PATCH",
    );
  }
  const reminder = await fixture.request(
    `${journey.path}/reminders`,
    owner.token,
    {
      requestId: randomUUID(),
      category: "expected_delivery",
      title: "Check parcel receipt",
      ownerMemberId: owner.id,
      familyId: journey.familyId,
      entryId: item.data.entry.id,
      dueAt: { dateTime: "2026-11-01T09:00:00+03:00", timeZone: "Asia/Riyadh" },
    },
    "POST",
  );
  assert.equal(reminder.status, 201);
  await fixture.request(
    "/api/notifications/dispatch",
    "fixture-dispatch-only",
    {},
    "POST",
  );
  assert.equal(
    fixture.pushes.length,
    before + 1,
    "The reminder owner need not be the checklist assignee",
  );
  const correction = {
    requestId: randomUUID(),
    kind: "correct",
    fields: { expectedDeliveryDate: "2026-11-19" },
  };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await fixture.request(
          `${checklist}/entries/${item.data.entry.id}/acquisition`,
          owner.token,
          correction,
          "POST",
        )
      ).status,
      200,
    );
  await fixture.request(
    "/api/notifications/dispatch",
    "fixture-dispatch-only",
    {},
    "POST",
  );
  assert.equal(
    fixture.pushes.length,
    before + 2,
    "One accepted expected-delivery change notifies the assignee once",
  );
});
