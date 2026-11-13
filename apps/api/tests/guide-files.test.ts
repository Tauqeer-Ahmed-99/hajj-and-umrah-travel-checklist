import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { startFixture } from "./support/fixture";
import { startR2Fixture } from "./support/r2-fixture";
import { PDFDocument } from "pdf-lib";
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
async function startUpload(
  owner: Awaited<ReturnType<typeof setup>>,
  bytes: Buffer,
  type = "application/pdf",
  path = owner.path,
) {
  const created = await fixture.request(
    `${path}/uploads`,
    owner.token,
    {
      ...(path === owner.path
        ? { title: "File guide", category: "Travel", familyId: owner.familyId }
        : {}),
      fileName: "guide.file",
      mediaType: type,
      byteSize: bytes.length,
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  const guidePath = `${owner.path}/${created.data.guide.id}`;
  const uploadPath = `${guidePath}/uploads/${created.data.upload.id}`;
  const signed = await fixture.request(
    `${uploadPath}/authorize`,
    owner.token,
    {},
    "POST",
  );
  assert.equal(signed.status, 200, fixture.logs());
  return {
    guidePath,
    uploadPath,
    auth: signed.data,
    guide: created.data.guide,
  };
}
async function put(
  auth: { url: string; headers: Record<string, string> },
  bytes: Buffer,
) {
  const response = await fetch(auth.url, {
    method: "PUT",
    headers: auth.headers,
    body: new Uint8Array(bytes),
  });
  assert.equal(response.status, 200, await response.text());
}
test("JPEG, PNG and WebP are decoded before publication; renamed, truncated, missing and oversized files stay incomplete", async () => {
  const owner = await setup("image_owner");
  for (const format of ["jpeg", "png", "webp"] as const) {
    const bytes = await sharp({
      create: { width: 12, height: 10, channels: 3, background: "green" },
    })
      [format]()
      .toBuffer();
    const upload = await startUpload(owner, bytes, `image/${format}`);
    await put(upload.auth, bytes);
    const result = await fixture.request(
      `${upload.uploadPath}/finalize`,
      owner.token,
      {},
      "POST",
    );
    assert.equal(result.status, 200, fixture.logs());
    assert.equal(result.data.guide.file.mediaType, `image/${format}`);
  }
  for (const bytes of [
    Buffer.from("<html>Not a PDF</html>"),
    Buffer.from("%PDF-1.7\n%%EOF"),
  ]) {
    const upload = await startUpload(owner, bytes);
    assert.equal(
      (
        await fixture.request(
          `${upload.uploadPath}/finalize`,
          owner.token,
          {},
          "POST",
        )
      ).status,
      409,
    );
    await put(upload.auth, bytes);
    assert.equal(
      (
        await fixture.request(
          `${upload.uploadPath}/finalize`,
          owner.token,
          {},
          "POST",
        )
      ).status,
      422,
    );
    assert.equal(
      (
        await fixture.request(
          `${upload.guidePath}/open`,
          owner.token,
          {},
          "POST",
        )
      ).status,
      409,
    );
    assert.equal(
      (await fixture.request(upload.guidePath, owner.token)).data.guide.version,
      1,
    );
  }
  const png = await sharp({
    create: { width: 100, height: 100, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  const truncated = png.subarray(0, 40),
    upload = await startUpload(owner, truncated, "image/png");
  await put(upload.auth, truncated);
  assert.equal(
    (
      await fixture.request(
        `${upload.uploadPath}/finalize`,
        owner.token,
        {},
        "POST",
      )
    ).status,
    422,
  );
  const dishonest = await startUpload(owner, png, "image/png");
  await put(dishonest.auth, png);
  storage.replaceUploadedObject(
    dishonest.auth.url,
    Buffer.alloc(20_000_001, 65),
  );
  assert.equal(
    (
      await fixture.request(
        `${dishonest.uploadPath}/finalize`,
        owner.token,
        {},
        "POST",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await fixture.request(
        `${dishonest.guidePath}/open`,
        owner.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  for (const changes of [
    { byteSize: 20_000_001 },
    { byteSize: 0 },
    { mediaType: "image/svg+xml" },
    { fileName: "../guide.pdf" },
    { objectKey: "someone-elses-file" },
  ]) {
    assert.equal(
      (
        await fixture.request(
          `${owner.path}/uploads`,
          owner.token,
          {
            ...details,
            familyId: owner.familyId,
            requestId: randomUUID(),
            ...changes,
          },
          "POST",
        )
      ).status,
      422,
    );
  }
});
test("file operations reauthorize actual current trip/family grants, version audiences, sessions and crossed IDs", async () => {
  const owner = await setup("access_owner");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const first = await startUpload(owner, bytes);
  await put(first.auth, bytes);
  assert.equal(
    (
      await fixture.request(
        `${first.uploadPath}/finalize`,
        owner.token,
        {},
        "POST",
      )
    ).status,
    200,
  );
  const tripPath = owner.path.replace(/\/guides$/, "");
  async function admit(name: string, tripRole: string, familyRole?: string) {
    const token = await fixture.token(`user_${name}`, `${name}@example.test`);
    const profile = await fixture.request("/api/me", token, {
      firstName: "Aisha",
      lastName: "Ahmed",
      username: name,
    });
    const offered = await fixture.request(
      `${tripPath}/invitations`,
      owner.token,
      {
        recipient: { kind: "username", value: name },
        tripRole,
        ...(familyRole ? { familyId: owner.familyId, familyRole } : {}),
      },
      "POST",
    );
    assert.equal(offered.status, 201, fixture.logs());
    assert.equal(
      (
        await fixture.request(
          `/api/invitations/${offered.data.invitation.id}/accept`,
          token,
          {},
          "POST",
        )
      ).status,
      200,
    );
    return { token, id: profile.data.profile.id };
  }
  const organizer = await admit("file_organizer", "organizer");
  const viewer = await admit("file_viewer", "viewer", "viewer");
  const editor = await admit("file_editor", "member", "editor");
  const pending = await startUpload(
    owner,
    bytes,
    "application/pdf",
    first.guidePath,
  );
  const operations = [
    { path: `${pending.uploadPath}/authorize`, method: "POST", body: {} },
    { path: `${pending.uploadPath}/finalize`, method: "POST", body: {} },
    { path: `${first.guidePath}/open`, method: "POST", body: {} },
    { path: `${first.guidePath}/uploads`, method: "GET", body: undefined },
    { path: `${first.guidePath}/history`, method: "GET", body: undefined },
  ];
  for (const op of operations) {
    assert.equal(
      (await fixture.request(op.path, organizer.token, op.body, op.method))
        .status,
      404,
    );
    assert.equal(
      (await fixture.request(op.path, undefined, op.body, op.method)).status,
      401,
    );
  }
  assert.equal(
    (await fixture.request(owner.path, organizer.token)).data.count,
    0,
  );
  assert.equal(
    (await fixture.request(`${first.guidePath}/open`, viewer.token, {}, "POST"))
      .status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${pending.uploadPath}/authorize`,
        viewer.token,
        {},
        "POST",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${pending.uploadPath}/finalize`,
        viewer.token,
        {},
        "POST",
      )
    ).status,
    403,
  );
  const different = await startUpload(owner, bytes);
  assert.equal(
    (
      await fixture.request(
        `${first.guidePath}/uploads/${different.guide.id}/authorize`,
        owner.token,
        {},
        "POST",
      )
    ).status,
    404,
  );
  for (const suffix of ["open", `uploads/${pending.guide.id}/authorize`]) {
    assert.equal(
      (
        await fixture.request(
          `${first.guidePath}/${suffix}`,
          owner.token,
          { key: "guide-content/arbitrary" },
          "POST",
        )
      ).status,
      422,
    );
  }
  // After sharing, an ungranted organizer can open only shared versions.
  assert.equal(
    (
      await fixture.request(
        first.guidePath,
        owner.token,
        { audience: "trip", requestId: randomUUID() },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${first.guidePath}/open`,
        organizer.token,
        {},
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${first.guidePath}/open`,
        organizer.token,
        { version: 2 },
        "POST",
      )
    ).status,
    404,
  );
  assert.deepEqual(
    (
      await fixture.request(`${first.guidePath}/history`, organizer.token)
    ).data.versions.map((v: { guide: { version: number } }) => v.guide.version),
    [3],
  );
  // An already issued upload URL does not authorize publication after revocation.
  assert.equal(
    (
      await fixture.request(
        `${pending.uploadPath}/authorize`,
        editor.token,
        {},
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${tripPath}/members/${editor.id}`,
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
        `${pending.uploadPath}/finalize`,
        editor.token,
        {},
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${pending.uploadPath}/authorize`,
        editor.token,
        {},
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        first.guidePath,
        owner.token,
        { audience: "family", requestId: randomUUID() },
        "PATCH",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${first.guidePath}/open`,
        organizer.token,
        {},
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${tripPath}/families/${owner.familyId}/members/${viewer.id}`,
        owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${first.guidePath}/open`, viewer.token, {}, "POST"))
      .status,
    404,
  );
  const library = await fixture.request(owner.path, owner.token);
  assert.ok(!JSON.stringify(library.data).includes("guide-content/"));
  fixture.revoke("sess_user_access_owner");
  assert.equal(
    (await fixture.request(`${first.guidePath}/open`, owner.token, {}, "POST"))
      .status,
    401,
  );
});
test("failed replacements, provider outages and conditional-copy races preserve the previous ready version", async () => {
  const owner = await setup("replace_owner");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const first = await startUpload(owner, bytes);
  await put(first.auth, bytes);
  const ready = await fixture.request(
    `${first.uploadPath}/finalize`,
    owner.token,
    {},
    "POST",
  );
  assert.equal(ready.status, 200, fixture.logs());
  const bad = await startUpload(
    owner,
    Buffer.alloc(bytes.length, 65),
    "application/pdf",
    first.guidePath,
  );
  await put(bad.auth, Buffer.alloc(bytes.length, 65));
  assert.equal(
    (
      await fixture.request(
        `${bad.uploadPath}/finalize`,
        owner.token,
        {},
        "POST",
      )
    ).status,
    422,
  );
  assert.deepEqual(
    (await fixture.request(first.guidePath, owner.token)).data,
    ready.data,
  );
  const second = await startUpload(
    owner,
    bytes,
    "application/pdf",
    first.guidePath,
  );
  await put(second.auth, bytes);
  storage.available(false);
  try {
    assert.equal(
      (
        await fixture.request(
          `${second.uploadPath}/finalize`,
          owner.token,
          {},
          "POST",
        )
      ).status,
      503,
    );
  } finally {
    storage.available(true);
  }
  assert.deepEqual(
    (await fixture.request(first.guidePath, owner.token)).data,
    ready.data,
  );
  storage.raceCopy(Buffer.alloc(bytes.length, 66));
  assert.equal(
    (
      await fixture.request(
        `${second.uploadPath}/finalize`,
        owner.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  await put(second.auth, bytes);
  const [saved, retry] = await Promise.all(
    [1, 2].map(() =>
      fixture.request(`${second.uploadPath}/finalize`, owner.token, {}, "POST"),
    ),
  );
  assert.equal(saved.status, 200, fixture.logs());
  assert.deepEqual(saved.data, retry.data);
  assert.equal(saved.data.guide.version, 3);
  assert.notEqual(saved.data.guide.file.id, ready.data.guide.file.id);
  const old = await fixture.request(
    `${first.guidePath}/open`,
    owner.token,
    { version: 2 },
    "POST",
  );
  assert.equal(old.status, 200);
  assert.equal(old.data.file.id, ready.data.guide.file.id);
  assert.equal(
    (await fixture.request(`${first.guidePath}/uploads`, owner.token)).data
      .uploads.length,
    1,
  );
});
async function setup(name: string) {
  const token = await fixture.token(`user_${name}`, `${name}@example.test`);
  assert.equal(
    (
      await fixture.request("/api/me", token, {
        firstName: "Sana",
        lastName: "Ahmed",
        username: name,
      })
    ).status,
    200,
  );
  const trip = await fixture.request(
    "/api/trips",
    token,
    {
      name: "File journey",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Ahmed",
    },
    "POST",
  );
  assert.equal(trip.status, 201, fixture.logs());
  return {
    token,
    path: `/api/trips/${trip.data.trip.id}/guides`,
    familyId: trip.data.families[0].id,
  };
}
const details = {
  title: "Arrival document",
  category: "Travel",
  fileName: "arrival.pdf",
  mediaType: "application/pdf",
  byteSize: 200,
};
test("a file starts visibly incomplete, persists after restart, and creation retries retain one upload", async () => {
  const owner = await setup("file_owner");
  const body = {
    ...details,
    familyId: owner.familyId,
    requestId: randomUUID(),
  };
  const created = await fixture.request(
    `${owner.path}/uploads`,
    owner.token,
    body,
    "POST",
  );
  assert.equal(created.status, 201, fixture.logs());
  assert.equal(created.data.guide.kind, "file");
  assert.equal(created.data.guide.file, null);
  assert.equal(created.data.upload.status, "pending");
  assert.deepEqual(
    (await fixture.request(`${owner.path}/uploads`, owner.token, body, "POST"))
      .data,
    created.data,
  );
  await fixture.restartApi();
  assert.deepEqual(
    (await fixture.request(owner.path, owner.token)).data.guides,
    [created.data.guide],
  );
  const path = `${owner.path}/${created.data.guide.id}`;
  assert.equal(
    (await fixture.request(`${path}/open`, owner.token, {}, "POST")).status,
    409,
  );
  assert.equal(
    (await fixture.request(`${path}/uploads`, owner.token)).data.uploads[0].id,
    created.data.upload.id,
  );
  assert.equal(created.headers.get("cache-control"), "private, no-store");
});
test("direct exact-object authorization and verified finalization publish immutable PDF bytes once", async () => {
  const owner = await setup("pdf_owner");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const created = await fixture.request(
    `${owner.path}/uploads`,
    owner.token,
    {
      ...details,
      byteSize: bytes.length,
      familyId: owner.familyId,
      requestId: randomUUID(),
    },
    "POST",
  );
  const path = `${owner.path}/${created.data.guide.id}`,
    up = `${path}/uploads/${created.data.upload.id}`;
  const signed = await fixture.request(
    `${up}/authorize`,
    owner.token,
    {},
    "POST",
  );
  assert.equal(signed.status, 200, fixture.logs());
  const auth = signed.data;
  assert.equal(new URL(auth.url).searchParams.get("X-Amz-Expires"), "120");
  assert.equal((await fetch(auth.url, { method: "GET" })).status, 403);
  const crossed = new URL(auth.url);
  crossed.pathname += "other";
  assert.equal(
    (
      await fetch(crossed, {
        method: "PUT",
        headers: auth.headers,
        body: bytes,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(auth.url, {
        method: "PUT",
        headers: auth.headers,
        body: bytes,
      })
    ).status,
    200,
  );
  const saved = await fixture.request(
    `${up}/finalize`,
    owner.token,
    {},
    "POST",
  );
  assert.equal(saved.status, 200, fixture.logs());
  assert.equal(saved.data.guide.file.mediaType, "application/pdf");
  const opened = await fixture.request(`${path}/open`, owner.token, {}, "POST");
  assert.equal(opened.status, 200, fixture.logs());
  assert.deepEqual(
    Buffer.from(
      await (await fetch(opened.data.authorization.url)).arrayBuffer(),
    ),
    bytes,
  );
  // Old upload authorization remains usable only against staging, never the ready object.
  assert.equal(
    (
      await fetch(auth.url, {
        method: "PUT",
        headers: auth.headers,
        body: Buffer.alloc(bytes.length, 65),
      })
    ).status,
    200,
  );
  assert.deepEqual(
    Buffer.from(
      await (await fetch(opened.data.authorization.url)).arrayBuffer(),
    ),
    bytes,
  );
  assert.deepEqual(
    (await fixture.request(`${up}/finalize`, owner.token, {}, "POST")).data,
    saved.data,
  );
  assert.equal(
    (await fixture.request(`${path}/history`, owner.token)).data.versions
      .length,
    2,
  );
});
