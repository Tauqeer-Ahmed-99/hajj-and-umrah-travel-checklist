import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";
import { startR2Fixture } from "./support/r2-fixture";
import sharp from "sharp";

let fixture: Awaited<ReturnType<typeof startFixture>>;
let storage: Awaited<ReturnType<typeof startR2Fixture>>;
before(
  async () => {
    storage = await startR2Fixture();
    fixture = await startFixture(storage.env);
  },
  { timeout: 120_000 },
);
after(async () => {
  if (fixture) await fixture.close();
  if (storage) await storage.close();
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
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Safe departure",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Ahmed family",
    },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  return {
    path: `/api/trips/${created.data.trip.id}`,
    id: created.data.trip.id as string,
    familyId: created.data.families[0].id as string,
  };
}
async function admit(
  journey: { path: string; familyId: string },
  owner: { token: string },
  target: { token: string; username: string },
  family = true,
) {
  const offer = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
    {
      recipient: { kind: "username", value: target.username },
      tripRole: "member",
      ...(family ? { familyId: journey.familyId, familyRole: "editor" } : {}),
    },
    "POST",
  );
  assert.equal(offer.status, 201, fixture.logs());
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${offer.data.invitation.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    200,
    fixture.logs(),
  );
  return offer.data.invitation.id as string;
}

test("approved members receive responsibility atomically, persist across restart, and old transfer retries cannot restore authority", async () => {
  const owner = await member("transfer_owner"),
    next = await member("transfer_next");
  const journey = await trip(owner);
  await admit(journey, owner, next);
  const familyPath = `${journey.path}/families/${journey.familyId}`;
  const command = { targetMemberId: next.id, requestId: randomUUID() };
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/responsibility`,
        owner.token,
        command,
        "POST",
      )
    ).status,
    200,
    fixture.logs(),
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/responsibility`,
        owner.token,
        { ...command, requestId: randomUUID() },
        "POST",
      )
    ).status,
    200,
    fixture.logs(),
  );
  await fixture.restartApi();
  const detail = await fixture.request(journey.path, next.token);
  assert.equal(detail.data.trip.role, "organizer");
  assert.equal(detail.data.families[0].canCoordinate, true);
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/responsibility`,
        owner.token,
        command,
        "POST",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/members/${owner.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal((await fixture.request(journey.path, owner.token)).status, 404);
  assert.equal((await fixture.request(journey.path, next.token)).status, 200);
});

test("account removal durably denies application access during provider failure, retries explicitly, and never reboots old access", async () => {
  const owner = await member("remove_owner"),
    next = await member("remove_next");
  const journey = await trip(owner);
  await admit(journey, owner, next);
  const input = { confirmation: "Remove my account", requestId: randomUUID() };
  assert.equal(
    (await fixture.request("/api/me/removal", owner.token, input, "POST"))
      .status,
    409,
  );
  assert.equal((await fixture.request(journey.path, owner.token)).status, 200);
  await fixture.request(
    `${journey.path}/families/${journey.familyId}/responsibility`,
    owner.token,
    { targetMemberId: next.id, requestId: randomUUID() },
    "POST",
  );
  await fixture.request(
    `${journey.path}/responsibility`,
    owner.token,
    { targetMemberId: next.id, requestId: randomUUID() },
    "POST",
  );
  fixture.deletionOutcome("failed");
  const pending = await fixture.request(
    "/api/me/removal",
    owner.token,
    input,
    "POST",
  );
  assert.equal(pending.status, 202, fixture.logs());
  assert.equal(pending.data.state, "provider_pending");
  assert.equal((await fixture.request(journey.path, owner.token)).status, 403);
  assert.equal(
    (
      await fixture.request("/api/me", owner.token, {
        firstName: "Sana",
        lastName: "Ahmed",
        username: owner.username,
      })
    ).status,
    403,
  );
  await fixture.restartApi();
  assert.equal(
    (await fixture.request("/api/me/removal", owner.token)).data.state,
    "provider_pending",
  );
  assert.equal(
    (
      await fixture.request(
        "/api/me/removal",
        owner.token,
        { ...input, requestId: randomUUID() },
        "POST",
      )
    ).status,
    409,
  );
  fixture.deletionOutcome("ok");
  const completed = await fixture.request(
    "/api/me/removal",
    owner.token,
    input,
    "POST",
  );
  assert.equal(completed.status, 200, fixture.logs());
  assert.equal(completed.data.state, "completed");
  assert.equal(
    (await fixture.request("/api/me/removal", owner.token)).data.state,
    "completed",
  );
  assert.equal((await fixture.request("/api/me", owner.token)).status, 401);
  const resurrected = await fixture.token(
    `user_${owner.username}`,
    `${owner.username}@example.test`,
  );
  assert.equal((await fixture.request("/api/me", resurrected)).status, 403);
  assert.equal(
    (
      await fixture.request("/api/me", resurrected, {
        firstName: "Sana",
        lastName: "Ahmed",
        username: owner.username,
      })
    ).status,
    403,
  );
  assert.equal((await fixture.request(journey.path, next.token)).status, 200);
});

test("explicit group deletion requires owning authority, exact confirmation and scope; ordinary leaving never auto-deletes", async () => {
  const owner = await member("delete_owner"),
    other = await member("delete_other");
  const journey = await trip(owner),
    unrelated = await trip(owner);
  await admit(journey, owner, other, false);
  await fixture.request(`${journey.path}/members/${other.id}`, owner.token, {
    role: "organizer",
  });
  const otherFamily = await fixture.request(
    `${journey.path}/families`,
    other.token,
    { name: "Other family", requestId: randomUUID() },
    "POST",
  );
  assert.equal(otherFamily.status, 201, fixture.logs());
  const familyPath = `${journey.path}/families/${journey.familyId}`;
  const removal = { confirmation: "Delete family", requestId: randomUUID() };
  assert.equal(
    (await fixture.request(familyPath, other.token, removal, "DELETE")).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        journey.path,
        owner.token,
        { ...removal, confirmation: "Delete trip" },
        "DELETE",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        familyPath,
        owner.token,
        { ...removal, confirmation: "Delete trip" },
        "DELETE",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/members/${owner.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    409,
  );
  assert.equal(
    (await fixture.request(familyPath, owner.token, removal, "DELETE")).status,
    200,
    fixture.logs(),
  );
  assert.equal(
    (await fixture.request(`${familyPath}/travelers`, owner.token)).status,
    404,
  );
  assert.equal(
    (await fixture.request(familyPath, owner.token, removal, "DELETE")).status,
    404,
  );
  assert.equal(
    (await fixture.request(journey.path, other.token)).data.families[0].id,
    otherFamily.data.family.id,
  );
  assert.equal(
    (await fixture.request(unrelated.path, owner.token)).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        unrelated.path,
        owner.token,
        { ...removal, confirmation: "Delete trip" },
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(unrelated.path, owner.token)).status,
    404,
  );
});

async function recovery(requestId: string, retry = false) {
  const response = await fetch(`${fixture.url}/api/me/removal`, {
    method: retry ? "POST" : "GET",
    headers: {
      Authorization: `Removal ${requestId}`,
      ...(retry ? { "Content-Type": "application/json" } : {}),
    },
    ...(retry
      ? {
          body: JSON.stringify({
            confirmation: "Remove my account",
            requestId,
          }),
        }
      : {}),
  });
  return { status: response.status, data: await response.json() };
}

test("removal accepts only random UUIDv4 receipts and case-normalized recovery remains usable after provider deletion", async () => {
  const owner = await member("receipt_format");
  const invalid = await fixture.request(
    "/api/me/removal",
    owner.token,
    {
      confirmation: "Remove my account",
      requestId: "00000000-0000-1000-8000-000000000000",
    },
    "POST",
  );
  assert.equal(invalid.status, 422);
  assert.equal(
    (await fixture.request("/api/me/removal", owner.token)).data.state,
    "active",
  );
  const requestId = randomUUID().toUpperCase();
  const accepted = await fixture.request(
    "/api/me/removal",
    owner.token,
    { confirmation: "Remove my account", requestId },
    "POST",
  );
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.requestId, requestId.toLowerCase());
  assert.equal((await recovery(requestId)).data.state, "completed");
  assert.equal((await recovery(requestId, true)).data.state, "completed");
});
test("unknown provider completion remains pending until an explicit receipt retry confirms absence, even after the sign-in is gone", async () => {
  const owner = await member("unknown_owner");
  const input = { confirmation: "Remove my account", requestId: randomUUID() };
  fixture.deletionOutcome("unknown");
  const result = await fixture.request(
    "/api/me/removal",
    owner.token,
    input,
    "POST",
  );
  assert.equal(result.status, 202, fixture.logs());
  assert.equal(result.data.state, "provider_pending");
  assert.equal((await fixture.request("/api/me", owner.token)).status, 401);
  await fixture.restartApi();
  assert.equal(
    (await recovery(input.requestId)).data.state,
    "provider_pending",
  );
  assert.equal((await recovery(randomUUID())).status, 404);
  assert.equal(
    (await fixture.request("/api/trips", input.requestId)).status,
    401,
  );
  fixture.deletionOutcome("ok");
  assert.equal((await recovery(input.requestId, true)).data.state, "completed");
  assert.equal((await recovery(input.requestId)).data.state, "completed");
});

test("loss of PostgreSQL after provider deletion never reports completed; the durable receipt recovers after restart", async () => {
  const owner = await member("data_failure");
  const input = { confirmation: "Remove my account", requestId: randomUUID() };
  const boundary = fixture.holdNextDeletion();
  const removing = fixture.request(
    "/api/me/removal",
    owner.token,
    input,
    "POST",
  );
  await boundary.received;
  await fixture.postgres.stop();
  boundary.release();
  const result = await removing;
  assert.equal(result.status, 503, fixture.logs());
  await fixture.postgres.start();
  await fixture.restartApi();
  assert.equal(
    (await recovery(input.requestId)).data.state,
    "provider_pending",
  );
  assert.equal((await recovery(input.requestId, true)).data.state, "completed");
});

test("unapproved family access cannot be transferred or granted by an organizer, and simultaneous demotions retain effective administrators", async () => {
  const owner = await member("race_owner"),
    next = await member("race_next"),
    outsider = await member("race_outsider");
  const journey = await trip(owner),
    family = `${journey.path}/families/${journey.familyId}`;
  await admit(journey, owner, next);
  await admit(journey, owner, outsider, false);
  await fixture.request(`${journey.path}/members/${outsider.id}`, owner.token, {
    role: "organizer",
  });
  assert.equal(
    (
      await fixture.request(
        `${family}/responsibility`,
        owner.token,
        { targetMemberId: outsider.id, requestId: randomUUID() },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${family}/members/${outsider.id}`,
        outsider.token,
        { role: "coordinator" },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(`${family}/members/${next.id}`, owner.token, {
        role: "coordinator",
      })
    ).status,
    200,
  );
  const results = await Promise.all([
    fixture.request(`${family}/members/${owner.id}`, owner.token, {
      role: "editor",
    }),
    fixture.request(`${family}/members/${next.id}`, next.token, {
      role: "editor",
    }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const tripResults = await Promise.all([
    fixture.request(`${journey.path}/members/${owner.id}`, owner.token, {
      role: "member",
    }),
    fixture.request(`${journey.path}/members/${outsider.id}`, outsider.token, {
      role: "member",
    }),
  ]);
  assert.deepEqual(tripResults.map((r) => r.status).sort(), [200, 409]);
  const roster = await fixture.request(`${family}/members`, next.token);
  assert.equal(
    roster.data.members.filter(
      (m: { role: string }) => m.role === "coordinator",
    ).length,
    1,
  );
});

test("removal retains traveler, shared records, immutable file versions and authored history while all future/replayed access is denied", async () => {
  const owner = await member("history_owner"),
    next = await member("history_next");
  const journey = await trip(owner),
    family = `${journey.path}/families/${journey.familyId}`;
  const offer = await admit(journey, owner, next);
  const traveler = await fixture.request(
    `${family}/travelers`,
    owner.token,
    { firstName: "Child", lastName: "Ahmed", requestId: randomUUID() },
    "POST",
  );
  assert.equal(traveler.status, 201);
  const bag = await fixture.request(
    `${family}/bags`,
    owner.token,
    {
      name: "Retained bag",
      type: "Suitcase",
      carrierTravelerId: traveler.data.traveler.id,
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(bag.status, 201, fixture.logs());
  const category = await fixture.request(
    `${family}/checklist/categories`,
    owner.token,
    { name: "Essentials", requestId: randomUUID() },
    "POST",
  );
  const entry = await fixture.request(
    `${family}/checklist/entries`,
    owner.token,
    {
      kind: "item",
      categoryId: category.data.category.id,
      title: "Retained adapters",
      requiredQuantity: 2,
      unit: "pieces",
      beneficiaries: { kind: "family" },
      responsibleMemberId: owner.id,
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(entry.status, 201, fixture.logs());
  const acquired = await fixture.request(
    `${family}/checklist/entries/${entry.data.entry.id}/acquisition`,
    owner.token,
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
  const packed = await fixture.request(
    `${family}/packing`,
    owner.token,
    {
      requestId: randomUUID(),
      kind: "move",
      entryId: entry.data.entry.id,
      leg: "outbound",
      from: { kind: "unpacked" },
      to: { kind: "bag", id: bag.data.bags[0].id },
      quantity: 1,
      physicalConfirmed: true,
    },
    "POST",
  );
  assert.equal(packed.status, 200, fixture.logs());
  const guideInput = {
    familyId: journey.familyId,
    kind: "text",
    title: "Retained guide",
    category: "Travel",
    description: "",
    source: "Family",
    text: "Keep this shared record",
    textDirection: "auto",
    requestId: randomUUID(),
  };
  const guide = await fixture.request(
    `${journey.path}/guides`,
    owner.token,
    guideInput,
    "POST",
  );
  assert.equal(guide.status, 201, fixture.logs());
  const bytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
  const attachment = await fixture.request(
    `${journey.path}/travel-files`,
    owner.token,
    {
      kind: "attachment",
      familyId: journey.familyId,
      fileName: "retained.png",
      mediaType: "image/png",
      byteSize: bytes.length,
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(attachment.status, 201, fixture.logs());
  const filePath = `${journey.path}/travel-files/${attachment.data.record.id}`;
  const uploadPath = `${filePath}/uploads/${attachment.data.upload.id}`;
  const signed = await fixture.request(
    `${uploadPath}/authorize`,
    owner.token,
    {},
    "POST",
  );
  assert.equal(
    (
      await fetch(signed.data.url, {
        method: "PUT",
        headers: signed.data.headers,
        body: new Uint8Array(bytes),
      })
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${uploadPath}/finalize`, owner.token, {}, "POST"))
      .status,
    200,
    fixture.logs(),
  );
  const visibility = { audience: "trip", requestId: randomUUID() };
  assert.equal(
    (
      await fixture.request(
        `${filePath}/visibility`,
        owner.token,
        visibility,
        "POST",
      )
    ).status,
    200,
  );
  const review = await fixture.request(
    `${journey.path}/completion/review`,
    owner.token,
  );
  assert.equal(review.status, 200, fixture.logs());
  const completeInput = {
    kind: "complete",
    reviewToken: review.data.reviewToken,
    travelConfirmed: true,
    requestId: randomUUID(),
  };
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/completion`,
        owner.token,
        completeInput,
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/completion`,
        owner.token,
        {
          kind: "lesson",
          text: "Retain safe arrival history",
          requestId: randomUUID(),
        },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/completion`,
        owner.token,
        { kind: "archive", archiveConfirmed: true, requestId: randomUUID() },
        "POST",
      )
    ).status,
    200,
  );
  await fixture.request(
    `${family}/responsibility`,
    owner.token,
    { targetMemberId: next.id, requestId: randomUUID() },
    "POST",
  );
  await fixture.request(
    `${journey.path}/responsibility`,
    owner.token,
    { targetMemberId: next.id, requestId: randomUUID() },
    "POST",
  );
  fixture.deletionOutcome("failed");
  const input = { confirmation: "Remove my account", requestId: randomUUID() };
  assert.equal(
    (await fixture.request("/api/me/removal", owner.token, input, "POST"))
      .status,
    202,
  );
  assert.equal(
    (await fixture.request(`${family}/travelers`, next.token)).data.travelers[0]
      .id,
    traveler.data.traveler.id,
  );
  const history = await fixture.request(
    `${journey.path}/guides/${guide.data.guide.id}/history`,
    next.token,
  );
  assert.equal(history.status, 200, fixture.logs());
  assert.ok(JSON.stringify(history.data).includes("history_owner"));
  const checklist = await fixture.request(`${family}/checklist`, next.token);
  assert.equal(checklist.data.entries[0].responsibleMemberId, owner.id);
  const checklistHistory = await fixture.request(
    `${family}/checklist/history`,
    next.token,
  );
  assert.ok(JSON.stringify(checklistHistory.data).includes("history_owner"));
  const completion = await fixture.request(
    `${journey.path}/completion`,
    next.token,
  );
  assert.equal(completion.data.completedBy, owner.id);
  assert.equal(completion.data.archivedBy, owner.id);
  assert.ok(JSON.stringify(completion.data.lessons).includes("history_owner"));
  const activity = await fixture.request(
    `${journey.path}/overview/activity?entryId=${entry.data.entry.id}`,
    next.token,
  );
  assert.equal(activity.status, 200, fixture.logs());
  assert.ok(JSON.stringify(activity.data.history).includes("history_owner"));
  for (const path of [
    "/overview",
    "/overview/return",
    "/completion",
    "/completion/review",
  ]) {
    assert.equal(
      (await fixture.request(`${journey.path}${path}`, owner.token)).status,
      403,
    );
  }
  assert.equal(
    (await fixture.request("/api/trips/archives", owner.token)).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/completion`,
        owner.token,
        completeInput,
        "POST",
      )
    ).status,
    403,
  );
  assert.equal(
    (await fixture.request(`${family}/packing?leg=outbound`, next.token)).data
      .bags[0].id,
    bag.data.bags[0].id,
  );
  assert.equal(
    (
      await fixture.request(
        `${filePath}/open`,
        next.token,
        { version: 1 },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${filePath}/open`,
        next.token,
        { version: 2 },
        "POST",
      )
    ).status,
    200,
  );
  for (const path of [
    "/api/invitations",
    `${filePath}/open`,
    `${uploadPath}/finalize`,
    `${filePath}/visibility`,
    `${journey.path}/guides`,
  ]) {
    const body = path.endsWith("visibility")
      ? visibility
      : path.endsWith("guides")
        ? guideInput
        : {};
    assert.equal(
      (
        await fixture.request(
          path,
          owner.token,
          path === "/api/invitations" ? undefined : body,
          path === "/api/invitations" ? "GET" : "POST",
        )
      ).status,
      403,
      path,
    );
  }
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${offer}/accept`,
        owner.token,
        {},
        "POST",
      )
    ).status,
    403,
  );
  // Deleting exactly this owned family removes its API scope, while the other
  // trip remains available. No physical object deletion is attempted by this path.
  const other = await trip(next);
  assert.equal(
    (
      await fixture.request(
        family,
        next.token,
        { confirmation: "Delete family", requestId: randomUUID() },
        "DELETE",
      )
    ).status,
    200,
    fixture.logs(),
  );
  assert.equal(
    (await fixture.request(`${filePath}/open`, next.token, {}, "POST")).status,
    404,
  );
  assert.equal((await fixture.request(other.path, next.token)).status, 200);
  fixture.deletionOutcome("ok");
  assert.equal((await recovery(input.requestId, true)).data.state, "completed");
});

test("simultaneous account removals preserve the last administrator and old email invitations never admit a replacement account", async () => {
  fixture.deletionOutcome("failed");
  const owner = await member("simultaneous_owner"),
    next = await member("simultaneous_next");
  const journey = await trip(owner);
  await admit(journey, owner, next);
  await fixture.request(`${journey.path}/members/${next.id}`, owner.token, {
    role: "organizer",
  });
  await fixture.request(
    `${journey.path}/families/${journey.familyId}/members/${next.id}`,
    owner.token,
    { role: "coordinator" },
  );
  const separate = await trip(next);
  const offered = await fixture.request(
    `${separate.path}/invitations`,
    next.token,
    {
      recipient: { kind: "email", value: "simultaneous_owner@example.test" },
      tripRole: "member",
    },
    "POST",
  );
  assert.equal(offered.status, 201);
  // Transfer next's separate responsibilities to owner so both accounts can
  // attempt removal without an unrelated last-admin blocker determining the race.
  const accepted = await fixture.request(
    `/api/invitations/${offered.data.invitation.id}/accept`,
    owner.token,
    {},
    "POST",
  );
  assert.equal(accepted.status, 200);
  await fixture.request(
    `${separate.path}/families/${separate.familyId}/members/${owner.id}`,
    next.token,
    { role: "coordinator" },
  );
  await fixture.request(`${separate.path}/members/${owner.id}`, next.token, {
    role: "organizer",
  });
  const emailOffer = await fixture.request(
    `${journey.path}/invitations`,
    next.token,
    {
      recipient: { kind: "email", value: "simultaneous_owner@example.test" },
      tripRole: "member",
    },
    "POST",
  );
  const nextEmailOffer = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
    {
      recipient: { kind: "email", value: "simultaneous_next@example.test" },
      tripRole: "member",
    },
    "POST",
  );
  assert.equal(emailOffer.status, 201);
  assert.equal(nextEmailOffer.status, 201);
  const inputs = [owner, next].map(() => ({
    confirmation: "Remove my account",
    requestId: randomUUID(),
  }));
  const outcomes = await Promise.all(
    [owner, next].map((person, index) =>
      fixture.request("/api/me/removal", person.token, inputs[index], "POST"),
    ),
  );
  assert.deepEqual(
    outcomes.map((r) => r.status).sort(),
    [202, 409],
    fixture.logs(),
  );
  const removedIndex = outcomes.findIndex((r) => r.status === 202);
  const survivor = [owner, next][1 - removedIndex];
  assert.equal(
    (await fixture.request(journey.path, survivor.token)).data.trip.role,
    "organizer",
  );
  const removed = [owner, next][removedIndex];
  const oldEmailOffer = [emailOffer, nextEmailOffer][removedIndex];
  const replacementToken = await fixture.token(
    "user_replacement",
    `${removed.username}@example.test`,
  );
  assert.equal(
    (
      await fixture.request("/api/me", replacementToken, {
        firstName: "New",
        lastName: "Member",
        username: "replacement_owner",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${oldEmailOffer.data.invitation.id}`,
        replacementToken,
      )
    ).data.invitation.status,
    "revoked",
  );
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${oldEmailOffer.data.invitation.id}/accept`,
        replacementToken,
        {},
        "POST",
      )
    ).status,
    409,
  );
  assert.deepEqual(
    (await fixture.request("/api/trips", replacementToken)).data.trips,
    [],
  );
  fixture.deletionOutcome("ok");
  assert.equal(
    (await recovery(inputs[removedIndex].requestId, true)).data.state,
    "completed",
  );
});
