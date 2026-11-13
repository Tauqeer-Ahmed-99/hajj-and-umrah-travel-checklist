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
async function trip(owner: { token: string }) {
  const created = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Private journey name",
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
    familyId: created.data.families[0].id as string,
  };
}
const selection = () => ({
  tripDetails: false,
  travelFields: [] as string[],
  itineraryEntryIds: [] as string[],
  checklist: [] as { familyId: string; entryIds: string[] }[],
  includePreparation: false,
  includeTaskProgress: false,
});

test("summary includes only selected travel fields and explicitly selected itinerary entries", async () => {
  const owner = await member("summary_travel");
  const journey = await trip(owner);
  const edited = await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    {
      accommodationAddress: "Hotel address withheld",
      transportReference: "Bus 42",
      meetingPoint: "North gate withheld",
      contacts: [
        {
          name: "Travel desk withheld",
          phone: "+1234567",
          note: "Contact note withheld",
        },
      ],
    },
    "PATCH",
  );
  assert.equal(edited.status, 200);
  const stop = await fixture.request(
    `${journey.path}/itinerary/entries`,
    owner.token,
    {
      kind: "stop",
      title: "Madinah stop",
      transportReference: "Train 7",
      startsAt: {
        dateTime: "2026-11-21T15:30:00+03:00",
        timeZone: "Asia/Riyadh",
      },
      notes: "Private planning note withheld",
    },
    "POST",
  );
  assert.equal(stop.status, 201);
  const preview = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    {
      ...selection(),
      tripDetails: true,
      travelFields: ["transport"],
    },
    "POST",
  );
  assert.equal(preview.status, 200, fixture.logs());
  assert.deepEqual(preview.data, {
    text: "NMT Travel summary\n\nTrip travel details\nTransport: Bus 42",
  });
  assert.equal(preview.headers.get("cache-control"), "private, no-store");
  assert.match(preview.headers.get("vary") ?? "", /Authorization/i);
  const selected = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    {
      ...selection(),
      travelFields: ["dates", "transport"],
      itineraryEntryIds: [stop.data.entry.id],
    },
    "POST",
  );
  assert.deepEqual(selected.data, {
    text: "NMT Travel summary\n\nMadinah stop\nStart: 2026-11-21T15:30:00+03:00 (Asia/Riyadh)\nTransport: Train 7",
  });
  const references = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    {
      ...selection(),
      tripDetails: true,
      travelFields: ["dates", "accommodation", "meeting", "contacts"],
    },
    "POST",
  );
  assert.deepEqual(references.data, {
    text: "NMT Travel summary\n\nTrip travel details\nDeparture: 2026-11-20\nReturn: 2026-12-04\nAccommodation: Hotel address withheld\nMeeting point: North gate withheld\nContact: Travel desk withheld; phone: +1234567; Contact note withheld",
  });
});

async function entries(
  journey: Awaited<ReturnType<typeof trip>>,
  owner: Awaited<ReturnType<typeof member>>,
) {
  const path = `${journey.path}/families/${journey.familyId}/checklist`;
  const group = await fixture.request(
    `${path}/categories`,
    owner.token,
    { name: "Supplies" },
    "POST",
  );
  assert.equal(group.status, 201);
  const common = {
    categoryId: group.data.category.id,
    beneficiaries: { kind: "family" },
    responsibleMemberId: owner.id,
  };
  const supply = await fixture.request(
    `${path}/entries`,
    owner.token,
    {
      ...common,
      kind: "item",
      title: "Charging adapters",
      unit: "adapters",
      requiredQuantity: 4,
      notes: "Private note withheld",
      source: "https://private.example.test/file?token=secret",
      priority: "essential",
    },
    "POST",
  );
  assert.equal(supply.status, 201);
  const task = await fixture.request(
    `${path}/entries`,
    owner.token,
    {
      ...common,
      kind: "task",
      title: "Call hotel",
      taskStatus: "done",
    },
    "POST",
  );
  assert.equal(task.status, 201);
  const omitted = await fixture.request(
    `${path}/entries`,
    owner.token,
    {
      ...common,
      kind: "task",
      title: "Unselected task withheld",
      taskStatus: "to_do",
    },
    "POST",
  );
  assert.equal(omitted.status, 201);
  return {
    path,
    supply: supply.data.entry.id as string,
    task: task.data.entry.id as string,
  };
}

test("checklist fallback preserves requirements and separates selected preparation quantities from task counts", async () => {
  const owner = await member("summary_checklist");
  const journey = await trip(owner);
  const list = await entries(journey, owner);
  for (const to of ["alreadyAvailable", "received", "ordered"]) {
    const moved = await fixture.request(
      `${list.path}/entries/${list.supply}/acquisition`,
      owner.token,
      {
        kind: "move",
        from: "remaining",
        to,
        quantity: 1,
        physicalConfirmed: to !== "ordered",
        requestId: randomUUID(),
      },
      "POST",
    );
    assert.equal(moved.status, 200);
  }
  const chosen = {
    ...selection(),
    checklist: [
      { familyId: journey.familyId, entryIds: [list.supply, list.task] },
    ],
  };
  const fallback = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    chosen,
    "POST",
  );
  assert.equal(fallback.status, 200, fixture.logs());
  assert.deepEqual(fallback.data, {
    text: "NMT Travel summary\n\nChecklist: Ahmed family\nItem: Charging adapters [outbound; essential]\nRequired: 4 adapters\nTask: Call hotel [outbound; normal]",
  });
  const progress = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    {
      ...chosen,
      includePreparation: true,
      includeTaskProgress: true,
    },
    "POST",
  );
  assert.equal(progress.status, 200);
  assert.deepEqual(progress.data, {
    text: "NMT Travel summary\n\nChecklist: Ahmed family\nItem: Charging adapters [outbound; essential]\nRequired: 4 adapters\nPreparation: 2 adapters available; 1 adapters still to arrange; 1 adapters awaiting receipt; 2 adapters remaining to be ready\nTask: Call hotel [outbound; normal]\nTask progress: Done\nPreparation items selected: 1; physically available for requirement: 0; not needed: 0\nTasks selected: 1; To do: 0; In progress: 0; Done: 1; Not needed: 0\nPreparation quantities do not confirm packing.",
  });
  for (const hidden of [
    "Private note",
    "private.example",
    "secret",
    "Unselected task",
    "summary_checklist@example.test",
    owner.token,
  ]) {
    assert.ok(!progress.data.text.includes(hidden), hidden);
  }
});

async function admit(
  journey: Awaited<ReturnType<typeof trip>>,
  owner: Awaited<ReturnType<typeof member>>,
  target: Awaited<ReturnType<typeof member>>,
  tripRole = "viewer",
  family = true,
) {
  const offered = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
    {
      recipient: { kind: "username", value: target.username },
      tripRole,
      ...(family ? { familyId: journey.familyId, familyRole: "viewer" } : {}),
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
  assert.equal(accepted.status, 200);
}

test("summary choices filter families for viewers and organizers and reauthorize each selected resource", async () => {
  const owner = await member("summary_scope_owner");
  const viewer = await member("summary_scope_viewer");
  const organizer = await member("summary_scope_organizer");
  const outsider = await member("summary_scope_outsider");
  const journey = await trip(owner);
  const list = await entries(journey, owner);
  await admit(journey, owner, viewer);
  await admit(journey, owner, organizer, "organizer", false);
  const viewerChoices = await fixture.request(
    `${journey.path}/summary`,
    viewer.token,
  );
  assert.equal(viewerChoices.status, 200, fixture.logs());
  assert.equal(viewerChoices.data.families.length, 1);
  assert.equal(viewerChoices.data.families[0].entries.length, 3);
  assert.deepEqual(
    Object.keys(viewerChoices.data.families[0].entries[0]).sort(),
    ["id", "kind", "title"],
  );
  const organizerChoices = await fixture.request(
    `${journey.path}/summary`,
    organizer.token,
  );
  assert.deepEqual(organizerChoices.data.families, []);
  const chosen = {
    ...selection(),
    checklist: [{ familyId: journey.familyId, entryIds: [list.supply] }],
    includePreparation: true,
  };
  const allowed = await fixture.request(
    `${journey.path}/summary`,
    viewer.token,
    chosen,
    "POST",
  );
  assert.equal(allowed.status, 200);
  for (const token of [organizer.token, outsider.token]) {
    const denied = await fixture.request(
      `${journey.path}/summary`,
      token,
      chosen,
      "POST",
    );
    assert.equal(denied.status, 404);
    assert.ok(!JSON.stringify(denied.data).includes("Charging adapters"));
  }
  const otherTrip = await trip(owner);
  const crossed = await fixture.request(
    `${otherTrip.path}/summary`,
    owner.token,
    chosen,
    "POST",
  );
  assert.equal(crossed.status, 404);
  const badEntry = await fixture.request(
    `${journey.path}/summary`,
    viewer.token,
    {
      ...chosen,
      checklist: [{ familyId: journey.familyId, entryIds: [randomUUID()] }],
    },
    "POST",
  );
  assert.equal(badEntry.status, 404);
  const removed = await fixture.request(
    `${journey.path}/families/${journey.familyId}/members/${viewer.id}`,
    owner.token,
    undefined,
    "DELETE",
  );
  assert.equal(removed.status, 200);
  const revoked = await fixture.request(
    `${journey.path}/summary`,
    viewer.token,
    chosen,
    "POST",
  );
  assert.equal(revoked.status, 404);
  const refreshed = await fixture.request(
    `${journey.path}/summary`,
    viewer.token,
  );
  assert.deepEqual(refreshed.data.families, []);
});

test("preview and repeated abandoned share preparations leak no account, invitation or guide data and mutate nothing", async () => {
  const owner = await member("summary_no_mutation");
  const outsider = await member("summary_no_access");
  const journey = await trip(owner);
  const list = await entries(journey, owner);
  const guide = await fixture.request(
    `${journey.path}/guides`,
    owner.token,
    {
      familyId: journey.familyId,
      kind: "link",
      title: "Private guide withheld",
      category: "Travel",
      url: "https://private.example.test/file?X-Amz-Signature=withheld",
    },
    "POST",
  );
  assert.equal(guide.status, 201);
  const invite = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
    {
      recipient: { kind: "email", value: "private-recipient@example.test" },
      tripRole: "member",
    },
    "POST",
  );
  assert.equal(invite.status, 201);
  const paths = [
    journey.path,
    `${journey.path}/members`,
    `${journey.path}/invitations`,
    `${journey.path}/guides`,
    `${journey.path}/itinerary`,
    list.path,
    `${list.path}/history`,
  ];
  const snapshot = async () =>
    Promise.all(
      paths.map(async (path) => {
        const result = await fixture.request(path, owner.token);
        assert.equal(result.status, 200);
        return result.data;
      }),
    );
  const before = await snapshot();
  const chosen = {
    ...selection(),
    tripDetails: true,
    travelFields: ["dates", "contacts"],
    checklist: [{ familyId: journey.familyId, entryIds: [list.task] }],
    includeTaskProgress: true,
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const choices = await fixture.request(
      `${journey.path}/summary`,
      owner.token,
    );
    const preview = await fixture.request(
      `${journey.path}/summary`,
      owner.token,
      chosen,
      "POST",
    );
    assert.equal(preview.status, 200);
    const content = JSON.stringify([choices.data, preview.data]);
    for (const hidden of [
      "@example.test",
      "X-Amz",
      "private.example",
      "Private guide withheld",
      owner.token,
      invite.data.invitation.id,
    ])
      assert.ok(!content.includes(hidden), hidden);
  }
  assert.deepEqual(await snapshot(), before);
  const deniedGuide = await fixture.request(
    `${journey.path}/guides/${guide.data.guide.id}`,
    outsider.token,
  );
  assert.equal(deniedGuide.status, 404);
  const deniedFile = await fixture.request(
    `${journey.path}/guides/${guide.data.guide.id}/open`,
    outsider.token,
    {},
    "POST",
  );
  assert.equal(deniedFile.status, 404);
  const outsiderTrips = await fixture.request("/api/trips", outsider.token);
  assert.deepEqual(outsiderTrips.data.trips, []);
});

test("refresh returns current contents, rejects removed or revoked selections, and supports empty and retry states", async () => {
  const owner = await member("summary_refresh");
  const journey = await trip(owner);
  const list = await entries(journey, owner);
  const chosen = {
    ...selection(),
    tripDetails: true,
    travelFields: ["meeting"],
  };
  const empty = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    chosen,
    "POST",
  );
  assert.deepEqual(empty.data, { text: "" });
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { meetingPoint: "Gate A" },
    "PATCH",
  );
  const displayed = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    chosen,
    "POST",
  );
  assert.equal(
    displayed.data.text,
    "NMT Travel summary\n\nTrip travel details\nMeeting point: Gate A",
  );
  await fixture.request(
    `${journey.path}/itinerary`,
    owner.token,
    { meetingPoint: "Gate B" },
    "PATCH",
  );
  const refreshed = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    chosen,
    "POST",
  );
  assert.equal(
    refreshed.data.text,
    "NMT Travel summary\n\nTrip travel details\nMeeting point: Gate B",
  );
  fixture.providerAvailable(false);
  try {
    const failed = await fixture.request(
      `${journey.path}/summary`,
      owner.token,
      chosen,
      "POST",
    );
    assert.equal(failed.status, 503);
    assert.ok(!JSON.stringify(failed.data).includes("Gate B"));
  } finally {
    fixture.providerAvailable(true);
  }
  const retry = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    chosen,
    "POST",
  );
  assert.deepEqual(retry.data, refreshed.data);
  const removed = await fixture.request(
    `${list.path}/entries/${list.supply}`,
    owner.token,
    { requestId: randomUUID(), reason: "Remove test requirement" },
    "DELETE",
  );
  assert.equal(removed.status, 200);
  const missing = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    {
      ...selection(),
      checklist: [{ familyId: journey.familyId, entryIds: [list.supply] }],
    },
    "POST",
  );
  assert.equal(missing.status, 404);
  fixture.revoke("sess_user_summary_refresh");
  const revoked = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    chosen,
    "POST",
  );
  assert.equal(revoked.status, 401);
});

test("summary rejects unsupported fields and resources and requires a verified completed member", async () => {
  const owner = await member("summary_validation");
  const journey = await trip(owner);
  const chosen = { ...selection(), tripDetails: true, travelFields: ["dates"] };
  for (const body of [
    selection(),
    { ...chosen, travelFields: ["email"] },
    { ...chosen, token: "secret" },
    { ...chosen, guideIds: [randomUUID()] },
    {
      ...chosen,
      itineraryEntryIds: [randomUUID(), randomUUID()],
      checklist: [{ familyId: randomUUID(), entryIds: [], audience: "trip" }],
    },
  ]) {
    const invalid = await fixture.request(
      `${journey.path}/summary`,
      owner.token,
      body,
      "POST",
    );
    assert.equal(invalid.status, 422);
  }
  assert.equal((await fixture.request(`${journey.path}/summary`)).status, 401);
  const incomplete = await fixture.token(
    "user_summary_incomplete",
    "incomplete@example.test",
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/summary`,
        incomplete,
        chosen,
        "POST",
      )
    ).status,
    403,
  );
  const crossed = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    { ...chosen, itineraryEntryIds: [randomUUID()] },
    "POST",
  );
  assert.equal(crossed.status, 404);
});

test("fallback reports inactive requirements truthfully and counts all task states only among selected records", async () => {
  const owner = await member("summary_not_needed");
  const journey = await trip(owner);
  const list = await entries(journey, owner);
  const corrected = await fixture.request(
    `${list.path}/entries/${list.supply}/acquisition`,
    owner.token,
    {
      kind: "correct",
      requestId: randomUUID(),
      fields: {
        notNeededReason: "Borrowing from a friend; private reason withheld",
      },
    },
    "POST",
  );
  assert.equal(corrected.status, 200);
  const base = {
    ...selection(),
    checklist: [{ familyId: journey.familyId, entryIds: [list.supply] }],
  };
  const required = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    base,
    "POST",
  );
  assert.equal(required.status, 200);
  assert.equal(
    required.data.text,
    "NMT Travel summary\n\nChecklist: Ahmed family\nItem: Charging adapters [outbound; essential]\nRequired: 0 adapters (Not needed; retained requirement: 4 adapters)",
  );
  const checklist = await fixture.request(list.path, owner.token);
  const categoryId = checklist.data.categories[0].id;
  const entryIds = [list.supply, list.task];
  for (const taskStatus of ["to_do", "in_progress", "not_needed"]) {
    const task = await fixture.request(
      `${list.path}/entries`,
      owner.token,
      {
        categoryId,
        kind: "task",
        title: `Task ${taskStatus}`,
        taskStatus,
        beneficiaries: { kind: "family" },
        responsibleMemberId: owner.id,
      },
      "POST",
    );
    assert.equal(task.status, 201);
    entryIds.push(task.data.entry.id);
  }
  const progress = await fixture.request(
    `${journey.path}/summary`,
    owner.token,
    {
      ...base,
      checklist: [{ familyId: journey.familyId, entryIds }],
      includePreparation: true,
      includeTaskProgress: true,
    },
    "POST",
  );
  assert.match(
    progress.data.text,
    /Preparation items selected: 1; physically available for requirement: 0; not needed: 1/,
  );
  assert.match(
    progress.data.text,
    /Tasks selected: 4; To do: 1; In progress: 1; Done: 1; Not needed: 1/,
  );
  assert.ok(!progress.data.text.includes("private reason"));
});
