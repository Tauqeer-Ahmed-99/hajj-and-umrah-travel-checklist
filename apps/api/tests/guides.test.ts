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
  const saved = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Guide journey",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Ahmed family",
    },
    "POST",
  );
  assert.equal(saved.status, 201, fixture.logs());
  return {
    path: `/api/trips/${saved.data.trip.id}`,
    familyId: saved.data.families[0].id as string,
  };
}
const note = {
  kind: "text",
  title: "Arrival reminder",
  category: "Travel",
  description: "Meeting instructions",
  source: "Family planning",
  text: "السلام عليكم\nMeet at reception.",
  textDirection: "auto",
};

async function admit(
  journey: { path: string },
  owner: { token: string },
  recipient: { token: string; username: string },
  tripRole = "member",
  familyId?: string,
  familyRole = "editor",
) {
  const offered = await fixture.request(
    `${journey.path}/invitations`,
    owner.token,
    {
      recipient: { kind: "username", value: recipient.username },
      tripRole,
      ...(familyId ? { familyId, familyRole } : {}),
    },
    "POST",
  );
  assert.equal(offered.status, 201, fixture.logs());
  assert.equal(
    (
      await fixture.request(
        `/api/invitations/${offered.data.invitation.id}/accept`,
        recipient.token,
        {},
        "POST",
      )
    ).status,
    200,
  );
}
const patch = (path: string, token: string, details: object) =>
  fixture.request(
    path,
    token,
    { ...details, requestId: randomUUID() },
    "PATCH",
  );

test("copy access revalidates the saved historical note, independently of current sharing or filtered lists", async () => {
  const owner = await member("copy_owner"),
    reader = await member("copy_reader");
  const journey = await trip(owner);
  await admit(journey, owner, reader, "viewer", journey.familyId, "viewer");
  const created = await fixture.request(
    `${journey.path}/guides`,
    owner.token,
    { ...note, familyId: journey.familyId },
    "POST",
  );
  const path = `${journey.path}/guides/${created.data.guide.id}`;
  const access = (token: string | undefined, version = 1) =>
    fixture.request(`${path}/copy-access`, token, { version }, "POST");
  const first = await access(reader.token);
  assert.equal(first.status, 200, fixture.logs());
  assert.equal(first.data.guide.text, note.text);
  assert.equal(first.data.guide.version, 1);
  assert.equal(first.data.latestVersion, 1);
  assert.equal(first.data.authorization, undefined);
  await patch(path, owner.token, {
    audience: "trip",
    text: "Updated arrival instructions",
  });
  assert.equal((await access(reader.token)).data.guide.text, note.text);
  assert.equal((await access(reader.token)).data.latestVersion, 2);
  assert.equal(
    (await fixture.request(`${journey.path}/guides?q=absent`, reader.token))
      .data.count,
    0,
  );
  assert.equal((await access(reader.token)).status, 200);
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/families/${journey.familyId}/members/${reader.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal((await fixture.request(path, reader.token)).status, 200);
  assert.equal((await access(reader.token)).status, 404);
  assert.equal((await access(reader.token, 2)).status, 200);
  assert.equal((await access(undefined)).status, 401);
  assert.equal((await access(owner.token, 999)).status, 404);
  assert.equal(
    (
      await fixture.request(
        `${path}/copy-access`,
        owner.token,
        { version: 0 },
        "POST",
      )
    ).status,
    422,
  );
  await patch(path, owner.token, { audience: "family" });
  assert.equal((await access(reader.token, 2)).status, 404);
});

test("a contributor creates a private text guide with attribution and reopens it after restart; retries create one version", async () => {
  const owner = await member("guide_owner");
  const journey = await trip(owner);
  const input = {
    ...note,
    familyId: journey.familyId,
    requestId: randomUUID(),
  };
  const [saved, retry] = await Promise.all(
    [1, 2].map(() =>
      fixture.request(`${journey.path}/guides`, owner.token, input, "POST"),
    ),
  );
  assert.equal(saved.status, 201, fixture.logs());
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.data, saved.data);
  const guide = saved.data.guide;
  assert.equal(guide.audience, "family");
  assert.equal(guide.version, 1);
  assert.equal(guide.pinned, false);
  assert.equal(guide.text, note.text);
  assert.equal(guide.contributor.username, "guide_owner");
  assert.equal(guide.updatedBy.username, "guide_owner");
  assert.ok(!JSON.stringify(saved.data).includes("@example.test"));
  await fixture.restartApi();
  const opened = await fixture.request(
    `${journey.path}/guides/${guide.id}`,
    owner.token,
  );
  assert.equal(opened.status, 200, fixture.logs());
  assert.deepEqual(opened.data, saved.data);
  assert.deepEqual(
    (await fixture.request(`${journey.path}/guides`, owner.token)).data,
    { guides: [guide], count: 1 },
  );
  const history = await fixture.request(
    `${journey.path}/guides/${guide.id}/history`,
    owner.token,
  );
  assert.equal(history.status, 200);
  assert.equal(history.data.versions.length, 1);
  assert.equal(history.data.versions[0].guide.text, note.text);
  assert.equal(opened.headers.get("cache-control"), "private, no-store");
  assert.match(opened.headers.get("vary") ?? "", /Authorization/i);
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/guides`,
        owner.token,
        { ...input, title: "Changed" },
        "POST",
      )
    ).status,
    409,
  );
});

test("pinning and literal title/metadata search count only current accessible guides, never note bodies or private emails", async () => {
  const owner = await member("search_owner");
  const editor = await member("search_editor");
  const journey = await trip(owner);
  await admit(journey, owner, editor);
  const save = async (title: string, source: string) => {
    const saved = await fixture.request(
      `${journey.path}/guides`,
      owner.token,
      {
        ...note,
        familyId: journey.familyId,
        title,
        source,
        text: "hidden_body_marker",
      },
      "POST",
    );
    assert.equal(saved.status, 201);
    return `${journey.path}/guides/${saved.data.guide.id}`;
  };
  const shared = await save("Airport instructions", "Desk 100% family");
  await save("Private Airport instructions", "Secret source");
  assert.equal(
    (await patch(shared, owner.token, { audience: "trip" })).status,
    200,
  );
  assert.equal(
    (await patch(shared, editor.token, { pinned: true })).status,
    200,
  );
  for (const q of [
    "airport",
    "Travel",
    "Meeting instructions",
    "100%",
    editor.username,
    "Sana",
  ]) {
    const result = await fixture.request(
      `${journey.path}/guides?q=${encodeURIComponent(q)}&pinned=true`,
      editor.token,
    );
    assert.equal(result.status, 200);
    assert.equal(result.data.count, 1);
    assert.equal(result.data.guides[0].title, "Airport instructions");
  }
  for (const q of [
    "Secret source",
    "hidden_body_marker",
    "@example.test",
    "no_match%_literal",
  ]) {
    assert.deepEqual(
      (
        await fixture.request(
          `${journey.path}/guides?q=${encodeURIComponent(q)}`,
          editor.token,
        )
      ).data,
      { guides: [], count: 0 },
    );
  }
  assert.equal(
    (await fixture.request(`${journey.path}/guides?pinned=true`, owner.token))
      .data.count,
    1,
  );
  assert.equal(
    (await fixture.request(`${journey.path}/guides`, owner.token)).data.count,
    2,
  );
  assert.equal(
    (await fixture.request(`${journey.path}/guides?pinned=maybe`, owner.token))
      .status,
    422,
  );
  await patch(shared, owner.token, { audience: "family" });
  assert.deepEqual(
    (
      await fixture.request(
        `${journey.path}/guides?q=airport&pinned=true`,
        editor.token,
      )
    ).data,
    { guides: [], count: 0 },
  );
});

test("only the owning coordinator shares; trip editors update shared guides, viewers read, and private history stays restricted", async () => {
  const owner = await member("audience_owner");
  const editor = await member("audience_editor");
  const viewer = await member("audience_viewer");
  const outsider = await member("audience_outside");
  const journey = await trip(owner);
  await admit(journey, owner, editor);
  await admit(journey, owner, viewer, "viewer");
  const saved = await fixture.request(
    `${journey.path}/guides`,
    owner.token,
    { ...note, familyId: journey.familyId },
    "POST",
  );
  assert.equal(saved.status, 201);
  const path = `${journey.path}/guides/${saved.data.guide.id}`;
  for (const account of [editor, viewer]) {
    assert.deepEqual(
      (await fixture.request(`${journey.path}/guides`, account.token)).data,
      { guides: [], count: 0 },
    );
    assert.equal((await fixture.request(path, account.token)).status, 404);
    assert.equal(
      (await fixture.request(`${path}/history`, account.token)).status,
      404,
    );
    assert.equal(
      (await patch(path, account.token, { audience: "trip" })).status,
      404,
    );
  }
  assert.equal(
    (await fixture.request(`${journey.path}/guides`, outsider.token)).status,
    404,
  );
  const shared = await patch(path, owner.token, { audience: "trip" });
  assert.equal(shared.status, 200, fixture.logs());
  assert.equal(shared.data.guide.version, 2);
  assert.equal(shared.data.guide.canShare, true);
  const opened = await fixture.request(path, editor.token);
  assert.equal(opened.data.guide.canEdit, true);
  assert.equal(opened.data.guide.canShare, false);
  assert.equal(
    (await patch(path, editor.token, { audience: "family" })).status,
    403,
  );
  assert.equal(
    (await patch(path, viewer.token, { title: "Viewer edit" })).status,
    403,
  );
  assert.equal(
    (await fixture.request(path, viewer.token)).data.guide.canEdit,
    false,
  );
  const edited = await patch(path, editor.token, {
    title: "Shared arrival reminder",
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.guide.version, 3);
  assert.equal(edited.data.guide.contributor.username, owner.username);
  assert.equal(edited.data.guide.updatedBy.username, editor.username);
  const history = await fixture.request(`${path}/history`, editor.token);
  assert.deepEqual(
    history.data.versions.map((v: any) => v.guide.version),
    [3, 2],
  );
  assert.deepEqual(history.data.versions[0].changedFields, ["title"]);
  assert.equal(
    (await fixture.request(`${path}/history`, owner.token)).data.versions
      .length,
    3,
  );
  assert.ok(!JSON.stringify(history.data).includes("@example.test"));
  assert.equal(
    (await patch(path, owner.token, { audience: "family" })).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${path}/history`, editor.token)).status,
    404,
  );
  assert.deepEqual(
    (await fixture.request(`${journey.path}/guides`, viewer.token)).data,
    { guides: [], count: 0 },
  );
});

test("partial edits retain competing fields, accepted order wins, and uncertain retries never replay over later versions", async () => {
  const owner = await member("retry_guide_owner");
  const editor = await member("retry_guide_editor");
  const journey = await trip(owner);
  await admit(journey, owner, editor, "member", journey.familyId);
  const saved = await fixture.request(
    `${journey.path}/guides`,
    editor.token,
    { ...note, familyId: journey.familyId },
    "POST",
  );
  assert.equal(saved.status, 201);
  const path = `${journey.path}/guides/${saved.data.guide.id}`;
  assert.equal(
    (await patch(path, editor.token, { audience: "trip" })).status,
    403,
  );
  const input = { title: "First accepted title", requestId: randomUUID() };
  const results = await Promise.all(
    [1, 2].map(() => fixture.request(path, editor.token, input, "PATCH")),
  );
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual(
    results.map((r) => r.data.guide.version),
    [2, 2],
  );
  const competing = await Promise.all([
    patch(path, owner.token, { title: "Latest title" }),
    patch(path, editor.token, { source: "Updated source" }),
  ]);
  assert.deepEqual(
    competing.map((r) => r.status),
    [200, 200],
  );
  const latest = (await fixture.request(path, owner.token)).data.guide;
  assert.equal(latest.title, "Latest title");
  assert.equal(latest.source, "Updated source");
  assert.equal(latest.version, 4);
  assert.equal(
    (await fixture.request(path, editor.token, input, "PATCH")).data.guide
      .title,
    "Latest title",
  );
  assert.equal(
    (
      await fixture.request(
        path,
        editor.token,
        { ...input, title: "Different retry" },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    (await patch(path, editor.token, { title: "Latest title" })).data.guide
      .version,
    4,
  );
  const history = (await fixture.request(`${path}/history`, owner.token)).data
    .versions;
  assert.deepEqual(
    history.map((v: any) => v.guide.version),
    [4, 3, 2, 1],
  );
  assert.equal(history[3].guide.title, "Arrival reminder");
  assert.equal(history[3].guide.contributor.username, editor.username);
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/families/${journey.familyId}/members/${editor.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(path, editor.token, input, "PATCH")).status,
    404,
  );
  assert.equal(
    (await fixture.request(`${path}/history`, editor.token)).status,
    404,
  );
  assert.deepEqual(
    (await fixture.request(`${journey.path}/guides?q=Latest`, editor.token))
      .data,
    { guides: [], count: 0 },
  );
});

test("organizing a trip cannot reveal another family's private guides, counts, search or history without a current grant", async () => {
  const organizer = await member("isolated_organizer");
  const coordinator = await member("isolated_coordinator");
  const journey = await trip(organizer);
  await admit(journey, organizer, coordinator);
  const family = await fixture.request(
    `${journey.path}/families`,
    organizer.token,
    { name: "Khan family" },
    "POST",
  );
  assert.equal(family.status, 201);
  const members = `${journey.path}/families/${family.data.family.id}/members`;
  assert.equal(
    (
      await fixture.request(`${members}/${coordinator.id}`, organizer.token, {
        role: "coordinator",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${members}/${organizer.id}`,
        organizer.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  const saved = await fixture.request(
    `${journey.path}/guides`,
    coordinator.token,
    { ...note, title: "Khan private guide", familyId: family.data.family.id },
    "POST",
  );
  assert.equal(saved.status, 201);
  const path = `${journey.path}/guides/${saved.data.guide.id}`;
  for (const suffix of ["", "/history"])
    assert.equal(
      (await fixture.request(path + suffix, organizer.token)).status,
      404,
    );
  assert.deepEqual(
    (await fixture.request(`${journey.path}/guides?q=Khan`, organizer.token))
      .data,
    { guides: [], count: 0 },
  );
  assert.equal(
    (await patch(path, organizer.token, { audience: "trip" })).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(`${members}/${organizer.id}`, coordinator.token, {
        role: "viewer",
      })
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(path, organizer.token)).data.guide.canEdit,
    false,
  );
  assert.equal(
    (await patch(path, organizer.token, { title: "Organizer bypass" })).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(`${members}/${organizer.id}`, coordinator.token, {
        role: "editor",
      })
    ).status,
    200,
  );
  assert.equal(
    (await patch(path, organizer.token, { title: "Explicitly permitted edit" }))
      .status,
    200,
  );
  assert.equal(
    (await patch(path, organizer.token, { audience: "trip" })).status,
    403,
  );
  await patch(path, coordinator.token, { audience: "trip" });
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/members/${organizer.id}`,
        organizer.token,
        undefined,
        "DELETE",
      )
    ).status,
    409,
  ); // retain the last organizer
  assert.equal(
    (
      await fixture.request(
        `${members}/${organizer.id}`,
        coordinator.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(path, organizer.token)).data.guide.canEdit,
    true,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/members/${coordinator.id}`,
        organizer.token,
        { role: "organizer" },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/members/${organizer.id}`,
        coordinator.token,
        undefined,
        "DELETE",
      )
    ).status,
    409,
  ); // still coordinates the initial family
  const other = await trip(coordinator);
  assert.equal(
    (
      await fixture.request(
        `${other.path}/guides/${saved.data.guide.id}`,
        coordinator.token,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${other.path}/guides/${saved.data.guide.id}/history`,
        coordinator.token,
      )
    ).status,
    404,
  );
});

test("link guides retain an external URL and reject unsafe schemes, client attribution, audience on creation, and malformed edits", async () => {
  const owner = await member("link_owner");
  const viewer = await member("link_viewer");
  const journey = await trip(owner);
  await admit(journey, owner, viewer, "viewer", journey.familyId, "viewer");
  const input = {
    familyId: journey.familyId,
    kind: "link",
    title: "Meeting map",
    category: "Travel",
    source: "Family meeting plan",
    url: "https://example.org/meeting?place=Makkah",
  };
  const saved = await fixture.request(
    `${journey.path}/guides`,
    owner.token,
    input,
    "POST",
  );
  assert.equal(saved.status, 201);
  assert.equal(saved.data.guide.url, input.url);
  assert.equal(saved.data.guide.text, "");
  const path = `${journey.path}/guides/${saved.data.guide.id}`;
  assert.equal((await fixture.request(path, viewer.token)).status, 200);
  assert.equal(
    (
      await fixture.request(
        `${journey.path}/guides`,
        viewer.token,
        input,
        "POST",
      )
    ).status,
    403,
  );
  for (const url of [
    "javascript:alert(1)",
    "file:///sdcard/private",
    "intent://example",
    "https://user:secret@example.org",
    "not a URL",
  ]) {
    assert.equal(
      (
        await fixture.request(
          `${journey.path}/guides`,
          owner.token,
          { ...input, url },
          "POST",
        )
      ).status,
      422,
    );
    assert.equal((await patch(path, owner.token, { url })).status, 422);
  }
  for (const extra of [
    { audience: "trip" },
    { contributor: owner.id },
    { version: 99 },
    { pinned: true },
  ]) {
    assert.equal(
      (
        await fixture.request(
          `${journey.path}/guides`,
          owner.token,
          { ...input, ...extra },
          "POST",
        )
      ).status,
      422,
    );
  }
  assert.equal(
    (await fixture.request(path, owner.token, { title: "No receipt" }, "PATCH"))
      .status,
    422,
  );
  assert.equal(
    (await patch(path, owner.token, { text: "Cannot combine link and text" }))
      .status,
    422,
  );
  assert.equal(
    (await fixture.request(path, owner.token)).data.guide.version,
    1,
  );
  assert.equal((await fixture.request(`${journey.path}/guides`)).status, 401);
  fixture.revoke("sess_user_link_viewer");
  assert.equal((await fixture.request(path, viewer.token)).status, 401);
});
