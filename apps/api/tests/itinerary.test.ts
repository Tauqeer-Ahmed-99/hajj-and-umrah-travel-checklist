import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startFixture } from "./support/fixture";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

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
async function trip(token: string, kind = "umrah") {
  const created = await fixture.request(
    "/api/trips",
    token,
    {
      name: "Family journey",
      kind,
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah", "Madinah"],
      familyName: "Ahmed family",
    },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  return `/api/trips/${created.data.trip.id}`;
}

test("an organizer saves travel references without any stops and reopens them after API restart", async () => {
  const owner = await member("itinerary_owner");
  const path = await trip(owner.token);
  const empty = await fixture.request(`${path}/itinerary`, owner.token);
  assert.equal(empty.status, 200, fixture.logs());
  assert.deepEqual(empty.data, {
    phase: "planning",
    accommodationAddress: "",
    transportReference: "",
    meetingPoint: "",
    contacts: [],
    entries: [],
    canEdit: true,
  });
  const input = {
    accommodationAddress: "Hotel reception, Makkah",
    transportReference: "Flight XY123 / booking ABC",
    meetingPoint: "Terminal 1, door 4",
    contacts: [
      {
        name: "Driver",
        phone: "+966 555 0100",
        note: "Call after baggage reclaim",
      },
    ],
  };
  const saved = await fixture.request(
    `${path}/itinerary`,
    owner.token,
    input,
    "PATCH",
  );
  assert.equal(saved.status, 200, fixture.logs());
  await fixture.restartApi();
  const reopened = await fixture.request(`${path}/itinerary`, owner.token);
  assert.deepEqual(reopened.data, { ...empty.data, ...input });
  const dates = (await fixture.request(path, owner.token)).data.trip;
  assert.equal(dates.startDate, "2026-11-20");
  assert.equal(dates.endDate, "2026-12-04");
  assert.equal(reopened.headers.get("cache-control"), "private, no-store");
  assert.match(reopened.headers.get("vary") ?? "", /Authorization/i);
});

test("safe entry retries recheck authority and reject changed details, crossed trips, invalid zones and nonexistent local times", async () => {
  const owner = await member("retry_itinerary");
  const viewer = await member("retry_viewer");
  const path = `${await trip(owner.token)}/itinerary`;
  const other = `${await trip(owner.token)}/itinerary`;
  const requestId = randomUUID();
  const input = {
    requestId,
    kind: "stop",
    title: "Arrival",
    startsAt: {
      dateTime: "2026-11-20T18:00:00+05:30",
      timeZone: "Asia/Kolkata",
    },
  };
  const outcomes = await Promise.all([
    fixture.request(`${path}/entries`, owner.token, input, "POST"),
    fixture.request(`${path}/entries`, owner.token, input, "POST"),
  ]);
  assert.deepEqual(
    outcomes.map((result) => result.status),
    [201, 201],
    fixture.logs(),
  );
  assert.deepEqual(outcomes[0].data, outcomes[1].data);
  const entryId = outcomes[0].data.entry.id;
  assert.equal(
    (await fixture.request(path, owner.token)).data.entries.length,
    1,
  );
  for (const [endpoint, details] of [
    [path, { ...input, title: "Different" }],
    [other, input],
  ] as const)
    assert.equal(
      (
        await fixture.request(
          `${endpoint}/entries`,
          owner.token,
          details,
          "POST",
        )
      ).status,
      409,
    );
  assert.equal(
    (
      await fixture.request(
        `${other}/entries/${entryId}`,
        owner.token,
        { title: "Wrong trip" },
        "PATCH",
      )
    ).status,
    404,
  );
  for (const startsAt of [
    { dateTime: "2026-11-20T18:00:00", timeZone: "Asia/Kolkata" },
    { dateTime: "2026-11-20T18:00:00+03:00", timeZone: "Missing/Place" },
    { dateTime: "2026-11-20T18:00:00+03:00", timeZone: "Asia/Kolkata" },
    { dateTime: "2026-03-08T02:30:00-05:00", timeZone: "America/New_York" },
    { dateTime: "2026-11-20T18:00:00+03:00", timeZone: "+03:00" },
  ])
    assert.equal(
      (
        await fixture.request(
          `${path}/entries/${entryId}`,
          owner.token,
          { startsAt },
          "PATCH",
        )
      ).status,
      422,
      JSON.stringify(startsAt),
    );
  for (const input of [
    {},
    { kind: "hajj_milestone", title: "Mina" },
    { kind: "stop", title: " ", completed: true },
  ])
    assert.equal(
      (await fixture.request(`${path}/entries`, owner.token, input, "POST"))
        .status,
      422,
    );
  const pool = new Pool({ connectionString: fixture.databaseUrl });
  try {
    await pool.query(
      "INSERT INTO trip_members (trip_id, member_id, role) VALUES ($1,$2,'viewer')",
      [path.split("/")[3], viewer.id],
    );
  } finally {
    await pool.end();
  }
  for (const [endpoint, body, method] of [
    [`${path}/entries`, input, "POST"],
    [`${path}/entries/${entryId}`, { notes: "No" }, "PATCH"],
    [`${path}/entries/${entryId}`, undefined, "DELETE"],
    [`${path}/order`, { entryIds: [entryId] }, "PUT"],
  ] as const)
    assert.equal(
      (await fixture.request(endpoint, viewer.token, body, method)).status,
      403,
    );
  await fixture.request(
    `${path}/entries/${entryId}`,
    owner.token,
    undefined,
    "DELETE",
  );
  assert.equal(
    (await fixture.request(`${path}/entries`, owner.token, input, "POST"))
      .status,
    410,
  );
  assert.equal(
    (await fixture.request(path, owner.token)).data.entries.length,
    0,
  );
  const revokedId = randomUUID();
  await fixture.request(
    `${path}/entries`,
    owner.token,
    { ...input, requestId: revokedId },
    "POST",
  );
  const demote = new Pool({ connectionString: fixture.databaseUrl });
  try {
    await demote.query(
      "UPDATE trip_members SET role = 'member' WHERE trip_id = $1 AND member_id = $2",
      [path.split("/")[3], owner.id],
    );
  } finally {
    await demote.end();
  }
  assert.equal(
    (
      await fixture.request(
        `${path}/entries`,
        owner.token,
        { ...input, requestId: revokedId },
        "POST",
      )
    ).status,
    403,
  );
});

test("partial itinerary edits preserve other accepted fields and ordered entries can be moved and removed safely", async () => {
  const owner = await member("edit_itinerary");
  const path = `${await trip(owner.token)}/itinerary`;
  const first = (
    await fixture.request(
      `${path}/entries`,
      owner.token,
      {
        kind: "stop",
        title: "Makkah",
        startsAt: {
          dateTime: "2026-11-20T10:00:00+03:00",
          timeZone: "Asia/Riyadh",
        },
        endsAt: {
          dateTime: "2026-11-21T10:00:00+03:00",
          timeZone: "Asia/Riyadh",
        },
      },
      "POST",
    )
  ).data.entry;
  const second = (
    await fixture.request(
      `${path}/entries`,
      owner.token,
      { kind: "stop", title: "Madinah" },
      "POST",
    )
  ).data.entry;
  const outcomes = await Promise.all([
    fixture.request(
      `${path}/entries/${first.id}`,
      owner.token,
      { title: "Makkah hotel" },
      "PATCH",
    ),
    fixture.request(
      `${path}/entries/${first.id}`,
      owner.token,
      { meetingPoint: "Reception" },
      "PATCH",
    ),
    fixture.request(
      path,
      owner.token,
      { transportReference: "XY123" },
      "PATCH",
    ),
    fixture.request(
      path,
      owner.token,
      { accommodationAddress: "Hotel street" },
      "PATCH",
    ),
  ]);
  assert.deepEqual(
    outcomes.map((outcome) => outcome.status),
    [200, 200, 200, 200],
    fixture.logs(),
  );
  await fixture.request(
    `${path}/entries/${first.id}`,
    owner.token,
    { title: "Latest hotel name" },
    "PATCH",
  );
  assert.equal(
    (
      await fixture.request(
        `${path}/entries/${first.id}`,
        owner.token,
        {
          startsAt: {
            dateTime: "2026-11-22T10:00:00+03:00",
            timeZone: "Asia/Riyadh",
          },
        },
        "PATCH",
      )
    ).status,
    422,
  );
  const moved = await fixture.request(
    `${path}/order`,
    owner.token,
    { entryIds: [second.id, first.id] },
    "PUT",
  );
  assert.equal(moved.status, 200, fixture.logs());
  assert.deepEqual(
    moved.data.entries.map((entry: { title: string }) => entry.title),
    ["Madinah", "Latest hotel name"],
  );
  assert.equal(moved.data.entries[1].meetingPoint, "Reception");
  assert.deepEqual(moved.data.entries[1].startsAt, first.startsAt);
  assert.equal(moved.data.transportReference, "XY123");
  assert.equal(moved.data.accommodationAddress, "Hotel street");
  for (const entryIds of [
    [first.id],
    [first.id, first.id],
    [first.id, randomUUID()],
  ])
    assert.ok(
      [409, 422].includes(
        (
          await fixture.request(
            `${path}/order`,
            owner.token,
            { entryIds },
            "PUT",
          )
        ).status,
      ),
    );
  for (let retry = 0; retry < 2; retry++)
    assert.equal(
      (
        await fixture.request(
          `${path}/entries/${first.id}`,
          owner.token,
          undefined,
          "DELETE",
        )
      ).status,
      200,
    );
  const reopened = await fixture.request(path, owner.token);
  assert.deepEqual(reopened.data.entries, [second]);
});

test("ordered optional stops and Hajj milestones retain explicit local offsets and zones after restart", async () => {
  const owner = await member("stops_owner");
  const path = `${await trip(owner.token, "hajj")}/itinerary`;
  const input = {
    requestId: randomUUID(),
    kind: "stop",
    title: "Madinah stay",
    startsAt: {
      dateTime: "2026-11-20T21:30:00+03:00",
      timeZone: "Asia/Riyadh",
    },
    endsAt: { dateTime: "2026-11-23T08:00:00+03:00", timeZone: "Asia/Riyadh" },
    accommodationAddress: "Hotel, gate 2",
    transportReference: "Train HHR123",
    meetingPoint: "Lobby",
    contacts: [{ name: "Reception", phone: "+966 123", note: "24 hours" }],
    notes: "Keep booking reference handy",
  };
  const first = await fixture.request(
    `${path}/entries`,
    owner.token,
    input,
    "POST",
  );
  assert.equal(first.status, 201, fixture.logs());
  const { requestId, ...expected } = input;
  assert.deepEqual(
    { ...first.data.entry, id: "entry", tripId: "trip" },
    { ...expected, id: "entry", tripId: "trip" },
  );
  const second = await fixture.request(
    `${path}/entries`,
    owner.token,
    { kind: "hajj_milestone", title: "Review Mina transport plan" },
    "POST",
  );
  assert.equal(second.status, 201, fixture.logs());
  assert.equal(second.data.entry.startsAt, null);
  assert.ok(!("completed" in second.data.entry));
  await fixture.restartApi();
  const reopened = await fixture.request(path, owner.token);
  assert.deepEqual(reopened.data.entries, [
    first.data.entry,
    second.data.entry,
  ]);
  assert.equal(reopened.data.phase, "planning");
});

test("only organizers manually choose phases, reviewing arrival for Completed; profiles, sessions and trip scope remain enforced", async () => {
  const owner = await member("phase_owner");
  const viewer = await member("phase_viewer");
  const editor = await member("phase_editor");
  const outsider = await member("phase_outsider");
  const incomplete = await fixture.token(
    "user_phase_incomplete",
    "incomplete@example.test",
  );
  const path = await trip(owner.token);
  const pool = new Pool({ connectionString: fixture.databaseUrl });
  try {
    for (const [actor, role] of [
      [viewer, "viewer"],
      [editor, "member"],
    ] as const)
      await pool.query(
        "INSERT INTO trip_members (trip_id, member_id, role) VALUES ($1,$2,$3)",
        [path.split("/").at(-1), actor.id, role],
      );
  } finally {
    await pool.end();
  }
  const endpoint = `${path}/itinerary`;
  for (const phase of [
    "preparing_at_home",
    "traveling_to_destination",
    "during_stay",
    "preparing_to_return",
    "traveling_home",
    "completed",
    "planning",
  ]) {
    const saved =
      phase === "completed"
        ? await fixture.request(
            `${path}/completion`,
            owner.token,
            {
              requestId: randomUUID(),
              kind: "complete",
              travelConfirmed: true,
              reviewToken: (
                await fixture.request(`${path}/completion/review`, owner.token)
              ).data.reviewToken,
            },
            "POST",
          )
        : await fixture.request(endpoint, owner.token, { phase }, "PATCH");
    assert.equal(saved.status, 200, fixture.logs());
    assert.equal(saved.data.phase, phase);
    assert.equal(
      (await fixture.request(endpoint, viewer.token)).data.phase,
      phase,
    );
  }
  for (const actor of [viewer, editor]) {
    assert.equal(
      (await fixture.request(endpoint, actor.token)).data.canEdit,
      false,
    );
    assert.equal(
      (
        await fixture.request(
          endpoint,
          actor.token,
          { phase: "completed" },
          "PATCH",
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await fixture.request(
          endpoint,
          actor.token,
          { meetingPoint: "Forbidden" },
          "PATCH",
        )
      ).status,
      403,
    );
  }
  for (const method of ["GET", "PATCH"]) {
    const input = method === "PATCH" ? { phase: "completed" } : undefined;
    assert.equal(
      (await fixture.request(endpoint, undefined, input, method)).status,
      401,
    );
    const gated = await fixture.request(endpoint, incomplete, input, method);
    assert.equal(gated.data.error.code, "profile_incomplete");
    assert.equal(
      (await fixture.request(endpoint, outsider.token, input, method)).status,
      404,
    );
  }
  assert.equal(
    (
      await fixture.request(
        endpoint,
        owner.token,
        { phase: "ritual_complete" },
        "PATCH",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await fixture.request(
        endpoint,
        owner.token,
        { phase: "completed", memberId: outsider.id },
        "PATCH",
      )
    ).status,
    422,
  );
  const reopened = await fixture.request(endpoint, viewer.token);
  assert.equal(reopened.data.phase, "planning");
  assert.ok(!JSON.stringify(reopened.data).includes("@example.test"));
  fixture.revoke("sess_user_phase_owner");
  assert.equal(
    (
      await fixture.request(
        endpoint,
        owner.token,
        { phase: "completed" },
        "PATCH",
      )
    ).status,
    401,
  );
});
