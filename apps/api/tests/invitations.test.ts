import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";
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
async function trip(owner: { token: string }) {
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "November Umrah",
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

test("a verified email recipient previews exact access and accepts once; forwarding never admits another account", async () => {
  const owner = await member("invite_owner");
  const recipient = await member("invite_recipient");
  const outsider = await member("invite_outsider");
  const journey = await trip(owner);
  const input = {
    recipient: { kind: "email", value: " INVITE_RECIPIENT@example.test " },
    tripRole: "member",
    familyId: journey.familyId,
    familyRole: "editor",
    requestId: randomUUID(),
  };
  const created = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
    input,
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  const invite = created.data.invitation;
  assert.equal(invite.trip.name, "November Umrah");
  assert.equal(invite.family.name, "Ahmed family");
  assert.equal(invite.tripRole, "member");
  assert.equal(invite.familyRole, "editor");
  assert.equal(invite.tripApproved, true);
  assert.equal(invite.familyApproved, true);
  assert.equal(
    Date.parse(invite.expiresAt) - Date.parse(invite.createdAt),
    604800000,
  );
  assert.ok(!JSON.stringify(created.data).includes("@example.test"));
  assert.deepEqual(
    (
      await fixture.request(
        `${journey.path}/invitations`,
        owner.token,
        input,
        "POST",
      )
    ).data,
    created.data,
  );
  const path = `/api/invitations/${invite.id}`;
  for (const method of ["GET", "POST"]) {
    const denied = await fixture.request(
      method === "GET" ? path : `${path}/accept`,
      outsider.token,
      method === "POST" ? {} : undefined,
      method,
    );
    assert.equal(denied.status, 404);
    assert.ok(!JSON.stringify(denied.data).includes("November"));
  }
  assert.deepEqual(
    (await fixture.request("/api/invitations", outsider.token)).data,
    { invitations: [] },
  );
  assert.equal(
    (await fixture.request(path, recipient.token)).data.invitation.id,
    invite.id,
  );
  assert.equal(
    (await fixture.request("/api/invitations", recipient.token)).data
      .invitations.length,
    1,
  );
  await fixture.restartApi();
  const accepted = await fixture.request(
    `${path}/accept`,
    recipient.token,
    {},
    "POST",
  );
  assert.equal(accepted.status, 200, fixture.logs());
  const reopened = await fixture.request(journey.path, recipient.token);
  assert.equal(reopened.data.trip.role, "member");
  assert.equal(reopened.data.families[0].role, "editor");
  assert.equal(reopened.data.families[0].canEdit, true);
  assert.equal(reopened.data.families[0].canCoordinate, false);
  assert.equal(
    (await fixture.request(`${path}/accept`, recipient.token, {}, "POST"))
      .status,
    409,
  );
  assert.equal(
    (await fixture.request(path, recipient.token)).data.invitation.status,
    "accepted",
  );
});

async function invite(
  journey: { path: string },
  actor: { token: string },
  target: { username: string },
  roles: Record<string, string> = {},
) {
  const created = await fixture.request(
    `${journey.path}/invitations`,
    actor.token,
    {
      recipient: { kind: "username", value: target.username.toUpperCase() },
      tripRole: "member",
      ...roles,
    },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  return created.data.invitation;
}
async function accept(id: string, actor: { token: string }) {
  const result = await fixture.request(
    `/api/invitations/${id}/accept`,
    actor.token,
    {},
    "POST",
  );
  assert.equal(result.status, 200, fixture.logs());
  return result;
}

test("a family coordinator proposes admission but only a trip organizer can approve it", async () => {
  const owner = await member("approval_owner");
  const coordinator = await member("approval_coordinator");
  const target = await member("approval_target");
  const journey = await trip(owner);
  await accept(
    (
      await invite(journey, owner, coordinator, {
        familyId: journey.familyId,
        familyRole: "coordinator",
      })
    ).id,
    coordinator,
  );
  const proposal = await invite(journey, coordinator, target, {
    familyId: journey.familyId,
    familyRole: "viewer",
    tripRole: "viewer",
  });
  assert.equal(proposal.tripApproved, false);
  assert.equal(proposal.familyApproved, true);
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${proposal.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  const approvalPath = `${journey.path}/invitations/${proposal.id}/approve`;
  assert.equal(
    (
      await fixture.request(
        approvalPath,
        coordinator.token,
        { scope: "trip" },
        "POST",
      )
    ).status,
    403,
  );
  const queue = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
  );
  assert.equal(queue.status, 200, fixture.logs());
  assert.ok(
    queue.data.invitations.some((i: { id: string }) => i.id === proposal.id),
  );
  assert.equal(
    (
      await fixture.request(
        approvalPath,
        owner.token,
        { scope: "trip" },
        "POST",
      )
    ).status,
    200,
    fixture.logs(),
  );
  await accept(proposal.id, target);
  const detail = (await fixture.request(journey.path, target.token)).data;
  assert.equal(detail.trip.role, "viewer");
  assert.equal(detail.families[0].canEdit, false);
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/families/${journey.familyId}/travelers`,
        target.token,
        { firstName: "Forbidden", lastName: "Traveler" },
        "POST",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/invitations`,
        target.token,
        {
          recipient: { kind: "username", value: owner.username },
          tripRole: "organizer",
        },
        "POST",
      )
    ).status,
    403,
  );
});

test("revoked and expired invitations cannot be accepted; concurrent acceptance consumes exactly once", async () => {
  const owner = await member("lifecycle_owner");
  const target = await member("lifecycle_target");
  const outsider = await member("lifecycle_other");
  const journey = await trip(owner);
  const revoked = await invite(journey, owner, target);
  const revokePath = `${journey.path}/invitations/${revoked.id}/revoke`;
  assert.equal(
    (await fixture.request(revokePath, outsider.token, {}, "POST")).status,
    404,
  );
  assert.equal(
    (await fixture.request(revokePath, owner.token, {}, "POST")).status,
    200,
    fixture.logs(),
  );
  assert.equal(
    (await fixture.request(revokePath, owner.token, {}, "POST")).status,
    200,
  );
  assert.equal(
    (await fixture.request(`/api/invitations/${revoked.id}`, target.token)).data
      .invitation.status,
    "revoked",
  );
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${revoked.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  const expired = await invite(journey, owner, target);
  // Time boundary precondition only; all behavior is observed through HTTP.
  const pool = new Pool({ connectionString: fixture.databaseUrl });
  try {
    await pool.query(
      "UPDATE invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1",
      [expired.id],
    );
  } finally {
    await pool.end();
  }
  assert.equal(
    (await fixture.request(`/api/invitations/${expired.id}`, target.token)).data
      .invitation.status,
    "expired",
  );
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${expired.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  assert.deepEqual((await fixture.request("/api/trips", target.token)).data, {
    trips: [],
  });
  const active = await invite(journey, owner, target);
  const results = await Promise.all(
    [1, 2].map(() =>
      fixture.request(
        `/api/invitations/${active.id}/accept`,
        target.token,
        {},
        "POST",
      ),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await fixture.request("/api/trips", target.token)).data.trips.length,
    1,
  );
  const raced = await invite(journey, owner, outsider);
  const race = await Promise.all([
    fixture.request(
      `/api/invitations/${raced.id}/accept`,
      outsider.token,
      {},
      "POST",
    ),
    fixture.request(
      `${journey.path}/invitations/${raced.id}/revoke`,
      owner.token,
      {},
      "POST",
    ),
  ]);
  assert.ok([200, 409].includes(race[0].status));
  assert.ok([200, 409].includes(race[1].status));
  const state = (
    await fixture.request(`/api/invitations/${raced.id}`, outsider.token)
  ).data.invitation.status;
  assert.ok(state === "accepted" || state === "revoked");
  assert.equal(
    (await fixture.request(journey.path, outsider.token)).status,
    state === "accepted" ? 200 : 404,
  );
});

test("shared-trip identities keep emails private; family grants and removal remain scoped to coordinators", async () => {
  const owner = await member("grant_owner");
  const second = await member("grant_organizer");
  const target = await member("grant_target");
  const journey = await trip(owner);
  await accept(
    (await invite(journey, owner, second, { tripRole: "organizer" })).id,
    second,
  );
  await accept((await invite(journey, owner, target)).id, target);
  const membersPath = `${journey.path}/members`;
  const people = await fixture.request(membersPath, target.token);
  assert.equal(people.status, 200, fixture.logs());
  assert.deepEqual(
    people.data.members.map((m: { username: string }) => m.username).sort(),
    [owner.username, second.username, target.username].sort(),
  );
  assert.ok(!JSON.stringify(people.data).includes("@example.test"));
  assert.equal(
    (await fixture.request("/api/members", owner.token)).status,
    404,
  );
  const familyPath = `${journey.path}/families/${journey.familyId}`;
  assert.equal(
    (await fixture.request(`${familyPath}/travelers`, second.token)).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/members/${target.id}`,
        second.token,
        { role: "editor" },
        "PUT",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${membersPath}/${target.id}`,
        target.token,
        { role: "organizer" },
        "PUT",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/members/${target.id}`,
        owner.token,
        { role: "viewer" },
        "PUT",
      )
    ).status,
    200,
  );
  let detail = (await fixture.request(journey.path, target.token)).data;
  assert.equal(detail.families[0].canEdit, false);
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/members/${target.id}`,
        target.token,
        { role: "coordinator" },
        "PUT",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/members/${target.id}`,
        owner.token,
        { role: "editor" },
        "PUT",
      )
    ).status,
    200,
  );
  detail = (await fixture.request(journey.path, target.token)).data;
  assert.equal(detail.families[0].canEdit, true);
  assert.equal(detail.families[0].canCoordinate, false);
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/members/${target.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${familyPath}/travelers`, target.token)).status,
    404,
  );
  assert.equal((await fixture.request(journey.path, target.token)).status, 200);
  assert.equal(
    (
      await fixture.request(
        `${membersPath}/${target.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal((await fixture.request(journey.path, target.token)).status, 404);
  assert.deepEqual((await fixture.request("/api/trips", target.token)).data, {
    trips: [],
  });
});

test("last organizer and coordinator protection survives simultaneous departures and viewer downgrades", async () => {
  const owner = await member("last_owner");
  const second = await member("last_second");
  const journey = await trip(owner);
  const familyPath = `${journey.path}/families/${journey.familyId}/members`;
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/${owner.id}`,
        owner.token,
        { role: "editor" },
        "PUT",
      )
    ).status,
    409,
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
    409,
  );
  await accept(
    (
      await invite(journey, owner, second, {
        tripRole: "organizer",
        familyId: journey.familyId,
        familyRole: "coordinator",
      })
    ).id,
    second,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/members/${owner.id}`,
        owner.token,
        { role: "viewer" },
        "PUT",
      )
    ).status,
    409,
  );
  const departures = await Promise.all(
    [owner, second].map((actor) =>
      fixture.request(
        `${familyPath}/${actor.id}`,
        actor.token,
        undefined,
        "DELETE",
      ),
    ),
  );
  assert.deepEqual(departures.map((r) => r.status).sort(), [200, 409]);
  const survivor = departures[0].status === 409 ? owner : second;
  const leaver = survivor === owner ? second : owner;
  const roster = await fixture.request(familyPath, survivor.token);
  assert.equal(
    roster.data.members.filter(
      (m: { role: string }) => m.role === "coordinator",
    ).length,
    1,
  );
  const denied = await fixture.request(
    `${journey.path}/members/${survivor.id}`,
    survivor.token,
    undefined,
    "DELETE",
  );
  assert.equal(denied.status, 409);
  assert.equal(denied.data.error.code, "last_coordinator");
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/members/${leaver.id}`,
        leaver.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  const last = await fixture.request(
    `${journey.path}/members/${survivor.id}`,
    survivor.token,
    { role: "member" },
    "PUT",
  );
  assert.equal(last.status, 409);
  assert.equal(last.data.error.code, "last_organizer");
  assert.equal(
    (await fixture.request(journey.path, survivor.token)).data.trip.role,
    "organizer",
  );
});

test("organizer approval cannot substitute for coordinator approval and lost authority requires fresh approval", async () => {
  const owner = await member("separate_owner");
  const coordinator = await member("separate_coordinator");
  const target = await member("separate_target");
  const journey = await trip(owner);
  const familyPath = `${journey.path}/families/${journey.familyId}/members`;
  await accept(
    (
      await invite(journey, owner, coordinator, {
        familyId: journey.familyId,
        familyRole: "coordinator",
      })
    ).id,
    coordinator,
  );
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/${owner.id}`,
        owner.token,
        { role: "editor" },
        "PUT",
      )
    ).status,
    200,
  );
  const proposed = await invite(journey, owner, target, {
    familyId: journey.familyId,
    familyRole: "editor",
  });
  assert.equal(proposed.tripApproved, true);
  assert.equal(proposed.familyApproved, false);
  const approval = `${journey.path}/invitations/${proposed.id}/approve`;
  assert.equal(
    (await fixture.request(approval, owner.token, { scope: "family" }, "POST"))
      .status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${proposed.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await fixture.request(
        approval,
        coordinator.token,
        { scope: "family" },
        "POST",
      )
    ).status,
    200,
  );
  // Restore another coordinator, then revoke and regrant the approver's role.
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/${owner.id}`,
        coordinator.token,
        { role: "coordinator" },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/${coordinator.id}`,
        owner.token,
        { role: "editor" },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${familyPath}/${coordinator.id}`,
        owner.token,
        { role: "coordinator" },
        "PUT",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`/api/invitations/${proposed.id}`, target.token))
      .data.invitation.familyApproved,
    false,
  );
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${proposed.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await fixture.request(
        approval,
        coordinator.token,
        { scope: "family" },
        "POST",
      )
    ).status,
    200,
  );
  const spoof = await fixture.request(
    `/api/invitations/${proposed.id}/accept`,
    target.token,
    { role: "organizer", memberId: owner.id },
    "POST",
  );
  assert.equal(spoof.status, 422);
  await accept(proposed.id, target);
  assert.equal(
    (await fixture.request(journey.path, target.token)).data.trip.role,
    "member",
  );
});

test("acceptance preserves current membership roles; revocation serializes with an authorized family write", async () => {
  const owner = await member("race_owner");
  const target = await member("race_target");
  const journey = await trip(owner);
  await accept(
    (await invite(journey, owner, target, { tripRole: "viewer" })).id,
    target,
  );
  const promotion = await invite(journey, owner, target, {
    familyId: journey.familyId,
    familyRole: "coordinator",
  });
  const denied = await fixture.request(
    `/api/invitations/${promotion.id}/accept`,
    target.token,
    {},
    "POST",
  );
  assert.equal(denied.status, 409);
  assert.equal(
    (await fixture.request(journey.path, target.token)).data.trip.role,
    "viewer",
  );
  assert.equal(
    (await fixture.request(journey.path, target.token)).data.families.length,
    0,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/members/${target.id}`,
        owner.token,
        { role: "member" },
        "PUT",
      )
    ).status,
    200,
  );
  await accept(promotion.id, target);
  const linked = await fixture.token(
    `user_${target.username}`,
    `${target.username}@example.test`,
    { sessionId: "sess_invitation_google_linked", strategy: "google_one_tap" },
  );
  assert.equal(
    (await fixture.request(journey.path, linked)).data.families[0].role,
    "coordinator",
  );
  const roster = `${journey.path}/families/${journey.familyId}/travelers`;
  const results = await Promise.all([
    fixture.request(
      roster,
      target.token,
      { firstName: "Aisha", lastName: "Ahmed" },
      "POST",
    ),
    fixture.request(
      `${journey.path}/families/${journey.familyId}/members/${target.id}`,
      owner.token,
      undefined,
      "DELETE",
    ),
  ]);
  assert.ok([201, 404].includes(results[0].status), fixture.logs());
  assert.equal(results[1].status, 200, fixture.logs());
  assert.equal((await fixture.request(roster, linked)).status, 404);
  assert.equal(
    (
      await fixture.request(
        roster,
        linked,
        { firstName: "Denied", lastName: "Traveler" },
        "POST",
      )
    ).status,
    404,
  );
});

test("an accepted email invitation stays with the member identity after an email change", async () => {
  const owner = await member("email_change_owner");
  const target = await member("email_change_target");
  const other = await member("email_change_other");
  const journey = await trip(owner);
  const created = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
    {
      recipient: { kind: "email", value: `${target.username}@example.test` },
      tripRole: "member",
    },
    "POST",
  );
  assert.equal(created.status, 201);
  const id = created.data.invitation.id;
  await accept(id, target);
  const changed = await fixture.token(
    `user_${target.username}`,
    "changed_verified@example.test",
    { sessionId: "sess_changed_email" },
  );
  assert.equal(
    (await fixture.request("/api/invitations", changed)).data.invitations
      .length,
    1,
  );
  assert.equal(
    (await fixture.request(`/api/invitations/${id}`, changed)).data.invitation
      .status,
    "accepted",
  );
  assert.equal((await fixture.request(journey.path, changed)).status, 200);
  const reassigned = await fixture.token(
    `user_${other.username}`,
    `${target.username}@example.test`,
    { sessionId: "sess_reassigned_email" },
  );
  assert.deepEqual(
    (await fixture.request("/api/invitations", reassigned)).data,
    { invitations: [] },
  );
  assert.equal(
    (await fixture.request(`/api/invitations/${id}`, reassigned)).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${id}/accept`,
        reassigned,
        {},
        "POST",
      )
    ).status,
    404,
  );
  assert.equal((await fixture.request(journey.path, reassigned)).status, 404);
});

test("removing access invalidates older offers without preventing a newly approved invitation", async () => {
  const owner = await member("old_offer_owner");
  const target = await member("old_offer_target");
  const journey = await trip(owner);
  await accept(
    (
      await invite(journey, owner, target, {
        familyId: journey.familyId,
        familyRole: "viewer",
      })
    ).id,
    target,
  );
  const old = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
    {
      recipient: { kind: "email", value: `${target.username}@example.test` },
      tripRole: "member",
      familyId: journey.familyId,
      familyRole: "editor",
    },
    "POST",
  );
  assert.equal(old.status, 201);
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/members/${target.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  const denied = await fixture.request(
    `/api/invitations/${old.data.invitation.id}/accept`,
    target.token,
    {},
    "POST",
  );
  assert.equal(denied.status, 409);
  assert.equal(denied.data.error.code, "access_removed");
  assert.equal((await fixture.request(journey.path, target.token)).status, 404);
  await accept(
    (
      await invite(journey, owner, target, {
        familyId: journey.familyId,
        familyRole: "viewer",
      })
    ).id,
    target,
  );
  const anotherOld = await invite(journey, owner, target, {
    familyId: journey.familyId,
    familyRole: "editor",
  });
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/families/${journey.familyId}/members/${target.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${anotherOld.id}/accept`,
        target.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/families/${journey.familyId}/travelers`,
        target.token,
      )
    ).status,
    404,
  );
});
