import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";
import {
  completionResponse,
  completionReviewResponse,
  archivesResponse,
} from "@nmt/contracts";
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
  const saved = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Home again",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Ahmed family",
    },
    "POST",
  );
  assert.equal(saved.status, 201, fixture.logs());
  const trip = `/api/trips/${saved.data.trip.id}`;
  return {
    owner,
    trip,
    familyId: saved.data.families[0].id as string,
    family: `${trip}/families/${saved.data.families[0].id}`,
  };
}
async function command(
  j: Awaited<ReturnType<typeof setup>>,
  body: object,
  token = j.owner.token,
) {
  return fixture.request(
    `${j.trip}/completion`,
    token,
    { requestId: randomUUID(), ...body },
    "POST",
  );
}
type Journey = Awaited<ReturnType<typeof setup>>;
async function admit(
  j: Journey,
  username: string,
  tripRole = "member",
  familyRole?: string,
) {
  const person = await member(username);
  const invite = await fixture.request(
    `${j.trip}/invitations`,
    j.owner.token,
    {
      recipient: { kind: "username", value: username },
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
async function belongings(j: Journey) {
  const category = await fixture.request(
    `${j.family}/checklist/categories`,
    j.owner.token,
    { name: "Private cupboard" },
    "POST",
  );
  const traveler = await fixture.request(
    `${j.family}/travelers`,
    j.owner.token,
    { firstName: "PrivateChild", lastName: "Ahmed" },
    "POST",
  );
  assert.equal(traveler.status, 201, fixture.logs());
  const bag = await fixture.request(
    `${j.family}/bags`,
    j.owner.token,
    {
      requestId: randomUUID(),
      name: "Private suitcase",
      type: "Checked",
      carrierTravelerId: traveler.data.traveler.id,
      identifyingNote: "Secret ribbon",
    },
    "POST",
  );
  assert.equal(bag.status, 201, fixture.logs());
  const item = await fixture.request(
    `${j.family}/checklist/entries`,
    j.owner.token,
    {
      kind: "item",
      title: "Private medicine",
      categoryId: category.data.category.id,
      requiredQuantity: 2,
      unit: "pieces",
      beneficiaries: { kind: "family" },
      responsibleMemberId: j.owner.id,
      priority: "essential",
    },
    "POST",
  );
  assert.equal(item.status, 201, fixture.logs());
  const entryId = item.data.entry.id as string;
  assert.equal(
    (
      await fixture.request(
        `${j.family}/checklist/entries/${entryId}/acquisition`,
        j.owner.token,
        {
          requestId: randomUUID(),
          kind: "move",
          from: "remaining",
          to: "received",
          quantity: 2,
          physicalConfirmed: true,
        },
        "POST",
      )
    ).status,
    200,
    fixture.logs(),
  );
  return {
    bagId: bag.data.bags[0].id as string,
    entryId,
    travelerId: traveler.data.traveler.id as string,
  };
}
test("home-arrival review is required for manual Completed, including the old itinerary path", async () => {
  const j = await setup("complete_review");
  const review = await fixture.request(
    `${j.trip}/completion/review`,
    j.owner.token,
  );
  assert.equal(review.status, 200, fixture.logs());
  completionReviewResponse.parse(review.data);
  assert.equal(review.data.scope, "permitted_records_only");
  assert.deepEqual(review.data.bags, []);
  assert.deepEqual(review.data.items, []);
  const bypass = await fixture.request(
    `${j.trip}/itinerary`,
    j.owner.token,
    { phase: "completed" },
    "PATCH",
  );
  assert.equal(bypass.status, 409);
  assert.equal(bypass.data.error.code, "completion_review_required");
  assert.equal((await command(j, { kind: "complete" })).status, 422);
  const saved = await command(j, {
    kind: "complete",
    reviewToken: review.data.reviewToken,
    travelConfirmed: true,
  });
  assert.equal(saved.status, 200, fixture.logs());
  completionResponse.parse(saved.data);
  assert.equal(saved.data.phase, "completed");
  assert.ok(saved.data.completedAt);
  assert.equal(saved.data.completedBy, j.owner.id);
  assert.equal(saved.data.archivedAt, null);
  assert.equal(saved.data.history.length, 1);
  assert.equal(saved.data.history[0].action, "completed");
  assert.equal(
    (await fixture.request(`${j.trip}/itinerary`, j.owner.token)).data.phase,
    "completed",
  );
  assert.equal("ritualCompleted" in saved.data, false);
});
test("review shows unverified home belongings only within the caller's family/shared permissions and detects a changed review", async () => {
  const j = await setup("arrival_privacy");
  const b = await belongings(j);
  const organizer = await admit(j, "arrival_organizer", "organizer");
  const viewer = await admit(j, "arrival_viewer", "viewer");
  const first = await fixture.request(
    `${j.trip}/completion/review`,
    j.owner.token,
  );
  assert.equal(first.status, 200, fixture.logs());
  assert.equal(first.data.bags[0].id, b.bagId);
  assert.equal(first.data.bags[0].status, null);
  assert.equal(first.data.items[0].entryId, b.entryId);
  assert.equal(first.data.items[0].verification, "unverified");
  assert.equal(first.data.items[0].possessionQuantity, null);
  const hidden = await fixture.request(
    `${j.trip}/completion/review`,
    organizer.token,
  );
  assert.deepEqual(hidden.data.bags, []);
  assert.deepEqual(hidden.data.items, []);
  assert.equal("allComplete" in hidden.data, false);
  assert.equal(
    (await fixture.request(`${j.family}/return-preparation`, organizer.token))
      .status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/return-preparation`,
        j.owner.token,
        { requestId: randomUUID(), kind: "propose" },
        "POST",
      )
    ).status,
    200,
  );
  const next = await fixture.request(
    `${j.trip}/completion/review`,
    j.owner.token,
  );
  assert.equal(next.data.items[0].unaccounted, 2);
  assert.equal(next.data.items[0].remainingToVerify, 2);
  assert.equal(
    (
      await command(j, {
        kind: "complete",
        reviewToken: first.data.reviewToken,
        travelConfirmed: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (await fixture.request(`${j.trip}/itinerary`, j.owner.token)).data.phase,
    "planning",
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/checklist/entries/${b.entryId}/visibility`,
        j.owner.token,
        { requestId: randomUUID(), audience: "trip" },
        "POST",
      )
    ).status,
    200,
  );
  const shared = await fixture.request(
    `${j.trip}/completion/review`,
    organizer.token,
  );
  assert.equal(shared.data.items.length, 1);
  assert.equal(shared.data.items[0].entryId, b.entryId);
  assert.equal(shared.data.items[0].verification, "limited");
  assert.equal(shared.data.items[0].unaccounted, null);
  const encoded = JSON.stringify(shared.data);
  for (const secret of [
    b.bagId,
    b.travelerId,
    "Private suitcase",
    "Secret ribbon",
    "PrivateChild",
    "Private cupboard",
  ])
    assert.equal(encoded.includes(secret), false, secret);
  assert.equal(
    (
      await command(
        j,
        {
          kind: "complete",
          reviewToken: shared.data.reviewToken,
          travelConfirmed: true,
        },
        viewer.token,
      )
    ).status,
    403,
  );
  const accepted = await command(
    j,
    {
      kind: "complete",
      reviewToken: shared.data.reviewToken,
      travelConfirmed: true,
    },
    organizer.token,
  );
  assert.equal(accepted.status, 200, fixture.logs());
  assert.equal(
    (await fixture.request(`${j.family}/packing?leg=return`, j.owner.token))
      .data.bags[0].legs[0].status,
    "packing",
  );
  assert.equal(
    (await fixture.request(`${j.family}/return-preparation`, j.owner.token))
      .data.items[0].possessionConfirmedAt,
    null,
  );
});
test("lessons and archive survive restart with both leg histories and existing reference permissions intact", async () => {
  const j = await setup("archive_retained");
  const b = await belongings(j);
  const reader = await admit(j, "archive_reader", "viewer", "viewer");
  const organizer = await admit(j, "archive_private_org", "organizer");
  const guide = await fixture.request(
    `${j.trip}/guides`,
    j.owner.token,
    {
      requestId: randomUUID(),
      familyId: j.familyId,
      kind: "text",
      title: "Private return contacts",
      category: "Travel",
      text: "Our family pickup details",
    },
    "POST",
  );
  assert.equal(guide.status, 201, fixture.logs());
  const guidePath = `${j.trip}/guides/${guide.data.guide.id}`;
  assert.equal(
    (await command(j, { kind: "archive", archiveConfirmed: true })).status,
    409,
  );
  const move = (leg: string) =>
    fixture.request(
      `${j.family}/packing`,
      j.owner.token,
      {
        requestId: randomUUID(),
        kind: "move",
        leg,
        entryId: b.entryId,
        from: { kind: "unpacked" },
        to: { kind: "bag", id: b.bagId },
        quantity: 2,
        physicalConfirmed: true,
      },
      "POST",
    );
  assert.equal((await move("outbound")).status, 200);
  assert.equal(
    (
      await fixture.request(
        `${j.family}/return-preparation`,
        j.owner.token,
        { requestId: randomUUID(), kind: "propose" },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/return-preparation`,
        j.owner.token,
        {
          requestId: randomUUID(),
          kind: "reconcile",
          entryId: b.entryId,
          fields: { possessionQuantity: 2 },
          reason: "Counted after stay",
          reviewConfirmed: true,
          physicalConfirmed: true,
        },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal((await move("return")).status, 200);
  assert.equal(
    (
      await fixture.request(
        `${j.family}/bags/${b.bagId}/state`,
        j.owner.token,
        {
          requestId: randomUUID(),
          leg: "return",
          status: "collected",
          reviewConfirmed: true,
        },
        "POST",
      )
    ).status,
    200,
  );
  const beforeOut = (
    await fixture.request(`${j.family}/packing?leg=outbound`, j.owner.token)
  ).data;
  const beforeReturn = (
    await fixture.request(`${j.family}/packing?leg=return`, j.owner.token)
  ).data;
  const review = await fixture.request(
    `${j.trip}/completion/review`,
    j.owner.token,
  );
  assert.equal(review.data.bags[0].status, "collected");
  assert.equal(review.data.items[0].verification, "reviewed");
  assert.equal(review.data.items[0].unaccounted, 0);
  assert.equal(
    (
      await command(j, {
        kind: "complete",
        reviewToken: review.data.reviewToken,
        travelConfirmed: true,
      })
    ).status,
    200,
  );
  const lesson = {
    requestId: randomUUID(),
    kind: "lesson",
    text: "Pack fewer adapters next time; keep a spare in hand luggage.",
  };
  const saved = await command(j, lesson);
  assert.equal(saved.status, 200, fixture.logs());
  assert.equal(saved.data.lessons[0].text, lesson.text);
  assert.equal((await command(j, lesson)).data.lessons.length, 1);
  const archived = await command(j, {
    kind: "archive",
    archiveConfirmed: true,
  });
  assert.equal(archived.status, 200, fixture.logs());
  assert.ok(archived.data.archivedAt);
  assert.deepEqual(
    archived.data.history.map((h: { action: string }) => h.action),
    ["completed", "lesson_added", "archived"],
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/itinerary`,
        j.owner.token,
        { phase: "traveling_home" },
        "PATCH",
      )
    ).status,
    409,
  );
  await fixture.restartApi();
  const read = await fixture.request(`${j.trip}/completion`, reader.token);
  assert.equal(read.status, 200, fixture.logs());
  assert.equal(read.data.canEdit, false);
  assert.deepEqual(read.data.lessons, archived.data.lessons);
  assert.equal(read.data.archivedAt, archived.data.archivedAt);
  const lookup = await fixture.request("/api/trips/archives", reader.token);
  assert.equal(lookup.status, 200, fixture.logs());
  archivesResponse.parse(lookup.data);
  assert.equal(lookup.data.archives[0].trip.id, j.trip.split("/").at(-1));
  assert.equal(lookup.data.archives[0].archivedAt, archived.data.archivedAt);
  assert.deepEqual(
    (await fixture.request(`${j.family}/packing?leg=outbound`, j.owner.token))
      .data,
    beforeOut,
  );
  assert.deepEqual(
    (await fixture.request(`${j.family}/packing?leg=return`, j.owner.token))
      .data,
    beforeReturn,
  );
  assert.equal(
    (await fixture.request(`${j.family}/checklist`, reader.token)).status,
    200,
  );
  assert.equal((await fixture.request(guidePath, reader.token)).status, 200);
  const otherArchive = await fixture.request(
    `${j.trip}/completion`,
    organizer.token,
  );
  assert.equal(otherArchive.status, 200);
  assert.deepEqual(otherArchive.data.lessons, archived.data.lessons);
  assert.equal((await fixture.request(guidePath, organizer.token)).status, 404);
  assert.equal(
    (await fixture.request(`${j.family}/packing?leg=outbound`, organizer.token))
      .status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/members/${reader.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${j.trip}/completion`, reader.token)).status,
    200,
  );
  const withoutGrant = await fixture.request(
    `${j.trip}/completion/review`,
    reader.token,
  );
  assert.deepEqual(withoutGrant.data.bags, []);
  assert.deepEqual(withoutGrant.data.items, []);
  assert.equal((await fixture.request(guidePath, reader.token)).status, 404);
  assert.equal(
    (await fixture.request(`${j.family}/checklist`, reader.token)).status,
    404,
  );
  assert.equal(
    (await fixture.request(`${j.trip}/itinerary`, reader.token)).data.phase,
    "completed",
  );
  assert.equal(
    (await command(j, { kind: "lesson", text: "Forbidden" }, reader.token))
      .status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/members/${reader.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  for (const path of [
    `${j.trip}/completion`,
    `${j.trip}/completion/review`,
    `${j.family}/checklist`,
    `${j.family}/packing?leg=return`,
    guidePath,
  ])
    assert.equal((await fixture.request(path, reader.token)).status, 404, path);
  assert.deepEqual(
    (await fixture.request("/api/trips/archives", reader.token)).data.archives,
    [],
  );
});
test("accepted retries never replay a corrected phase and concurrent lessons/archive retain every accepted event", async () => {
  const j = await setup("archive_races");
  const second = await admit(j, "archive_coorganizer", "organizer");
  const review = await fixture.request(
    `${j.trip}/completion/review`,
    j.owner.token,
  );
  const complete = {
    requestId: randomUUID(),
    kind: "complete",
    reviewToken: review.data.reviewToken,
    travelConfirmed: true,
  };
  const outcomes = await Promise.all([
    command(j, complete),
    command(j, complete),
  ]);
  assert.deepEqual(
    outcomes.map((r) => r.status),
    [200, 200],
  );
  assert.equal(
    (await fixture.request(`${j.trip}/completion`, j.owner.token)).data.history
      .length,
    1,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/itinerary`,
        j.owner.token,
        { phase: "traveling_home", meetingPoint: "Home pickup" },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal((await command(j, complete)).data.phase, "traveling_home");
  assert.equal(
    (await command(j, { ...complete, travelConfirmed: false })).status,
    422,
  );
  assert.equal(
    (await command(j, { ...complete, reviewToken: "f".repeat(64) })).status,
    409,
  );
  assert.equal(
    (await fixture.request(`${j.trip}/completion`, j.owner.token)).data.history
      .length,
    2,
  );
  const current = await fixture.request(
    `${j.trip}/completion/review`,
    j.owner.token,
  );
  assert.equal(
    (
      await command(j, {
        kind: "complete",
        reviewToken: current.data.reviewToken,
        travelConfirmed: true,
      })
    ).status,
    200,
  );
  const first = {
    requestId: randomUUID(),
    kind: "lesson",
    text: "Bring fewer bags.",
  };
  const other = {
    requestId: randomUUID(),
    kind: "lesson",
    text: "Keep booking details handy.",
  };
  const archive = {
    requestId: randomUUID(),
    kind: "archive",
    archiveConfirmed: true,
  };
  const saved = await Promise.all([
    command(j, first),
    command(j, first),
    command(j, other, second.token),
    command(j, archive),
    command(j, archive),
  ]);
  assert.deepEqual(
    saved.map((r) => r.status),
    [200, 200, 200, 200, 200],
    fixture.logs(),
  );
  const final = (await fixture.request(`${j.trip}/completion`, j.owner.token))
    .data;
  completionResponse.parse(final);
  assert.deepEqual(final.lessons.map((l: { text: string }) => l.text).sort(), [
    "Bring fewer bags.",
    "Keep booking details handy.",
  ]);
  assert.equal(
    final.history.filter((h: { action: string }) => h.action === "archived")
      .length,
    1,
  );
  assert.equal(final.history.length, 6);
  assert.equal(
    (await fixture.request(`${j.trip}/itinerary`, j.owner.token)).data
      .meetingPoint,
    "Home pickup",
  );
  assert.equal(
    (await command(j, { ...first, text: "Stale overwrite" })).status,
    409,
  );
  assert.deepEqual(
    (await fixture.request(`${j.trip}/completion`, j.owner.token)).data,
    final,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/members/${second.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal((await command(j, other, second.token)).status, 404);
  assert.equal((await fixture.request(`${j.trip}/completion`)).status, 401);
  const outsider = await member("archive_outsider");
  assert.equal(
    (await fixture.request(`${j.trip}/completion`, outsider.token)).status,
    404,
  );
});
test("a legacy Completed phase still needs the deliberate arrival confirmation before archive", async () => {
  const j = await setup("archive_legacy");
  // Historical fixture from before SQL019. Behavior is observed only over HTTP.
  const pool = new Pool({ connectionString: fixture.databaseUrl });
  try {
    await pool.query(
      "INSERT INTO trip_itineraries (trip_id,phase) VALUES ($1,'completed')",
      [j.trip.split("/").at(-1)],
    );
  } finally {
    await pool.end();
  }
  const legacy = await fixture.request(`${j.trip}/completion`, j.owner.token);
  assert.equal(legacy.data.phase, "completed");
  assert.equal(legacy.data.completedAt, null);
  assert.equal(
    (await command(j, { kind: "archive", archiveConfirmed: true })).status,
    409,
  );
  const review = await fixture.request(
    `${j.trip}/completion/review`,
    j.owner.token,
  );
  const saved = await command(j, {
    kind: "complete",
    travelConfirmed: true,
    reviewToken: review.data.reviewToken,
  });
  assert.equal(saved.status, 200, fixture.logs());
  assert.ok(saved.data.completedAt);
  assert.equal(saved.data.history.length, 1);
  assert.equal(
    (await command(j, { kind: "archive", archiveConfirmed: true })).status,
    200,
  );
});
