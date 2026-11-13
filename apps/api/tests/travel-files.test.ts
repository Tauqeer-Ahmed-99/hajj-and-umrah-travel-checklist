import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { startFixture } from "./support/fixture";
import { startR2Fixture } from "./support/r2-fixture";

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
async function member(name: string) {
  const token = await fixture.token(`user_${name}`, `${name}@example.test`);
  const result = await fixture.request("/api/me", token, {
    firstName: "Noor",
    lastName: "Ahmed",
    username: name,
  });
  assert.equal(result.status, 200, fixture.logs());
  return { token, id: result.data.profile.id as string };
}
async function setup(name: string) {
  const owner = await member(name);
  const result = await fixture.request(
    "/api/trips",
    owner.token,
    {
      name: "Travel files",
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Private family",
    },
    "POST",
  );
  assert.equal(result.status, 201, fixture.logs());
  const tripId = result.data.trip.id as string,
    familyId = result.data.families[0].id as string;
  const trip = `/api/trips/${tripId}`,
    family = `${trip}/families/${familyId}`,
    path = `${trip}/travel-files`;
  const traveler = await fixture.request(
    `${family}/travelers`,
    owner.token,
    { firstName: "Noor", lastName: "Ahmed", requestId: randomUUID() },
    "POST",
  );
  const bags = await fixture.request(
    `${family}/bags`,
    owner.token,
    {
      name: "Ribbon bag",
      type: "Suitcase",
      carrierTravelerId: traveler.data.traveler.id,
      requestId: randomUUID(),
    },
    "POST",
  );
  assert.equal(bags.status, 201, fixture.logs());
  return {
    owner,
    tripId,
    familyId,
    trip,
    family,
    path,
    bagId: bags.data.bags[0].id as string,
  };
}
async function image(format: "png" | "jpeg" | "webp" = "png") {
  return sharp({
    create: { width: 10, height: 12, channels: 3, background: "green" },
  })
    [format]()
    .toBuffer();
}
async function begin(
  j: Awaited<ReturnType<typeof setup>>,
  bytes: Buffer,
  extra: Record<string, unknown> = {},
) {
  const result = await fixture.request(
    j.path,
    j.owner.token,
    {
      kind: "bag_photo",
      bagId: j.bagId,
      familyId: j.familyId,
      fileName: "ribbon.png",
      mediaType: "image/png",
      byteSize: bytes.length,
      requestId: randomUUID(),
      ...extra,
    },
    "POST",
  );
  assert.equal(
    result.status,
    201,
    JSON.stringify(result.data) + fixture.logs(),
  );
  return {
    record: result.data.record,
    upload: result.data.upload,
    path: `${j.path}/${result.data.record.id}`,
    up: `${j.path}/${result.data.record.id}/uploads/${result.data.upload.id}`,
  };
}
async function put(up: string, token: string, bytes: Buffer) {
  const signed = await fixture.request(`${up}/authorize`, token, {}, "POST");
  assert.equal(signed.status, 200, fixture.logs());
  assert.equal(
    new URL(signed.data.url).searchParams.get("X-Amz-Expires"),
    "120",
  );
  const response = await fetch(signed.data.url, {
    method: "PUT",
    headers: signed.data.headers,
    body: new Uint8Array(bytes),
  });
  assert.equal(response.status, 200);
  return signed.data;
}
test("bag photo persists privately, validates actual image bytes and opens immutable content inside the app", async () => {
  const j = await setup("photo_owner"),
    bytes = await image();
  const upload = await begin(j, bytes);
  assert.equal(upload.record.file, null);
  assert.equal(
    (await fixture.request(`${upload.path}/open`, j.owner.token, {}, "POST"))
      .status,
    409,
  );
  const authorization = await put(upload.up, j.owner.token, bytes);
  const saved = await fixture.request(
    `${upload.up}/finalize`,
    j.owner.token,
    {},
    "POST",
  );
  assert.equal(saved.status, 200, fixture.logs());
  assert.equal(saved.data.record.version, 1);
  const opened = await fixture.request(
    `${upload.path}/open`,
    j.owner.token,
    {},
    "POST",
  );
  assert.equal(opened.status, 200, fixture.logs());
  assert.deepEqual(
    Buffer.from(
      await (await fetch(opened.data.authorization.url)).arrayBuffer(),
    ),
    bytes,
  );
  await fetch(authorization.url, {
    method: "PUT",
    headers: authorization.headers,
    body: Buffer.alloc(bytes.length, 65),
  });
  assert.deepEqual(
    Buffer.from(
      await (await fetch(opened.data.authorization.url)).arrayBuffer(),
    ),
    bytes,
  );
  assert.equal(
    (await fixture.request(`${upload.up}/finalize`, j.owner.token, {}, "POST"))
      .data.record.version,
    1,
  );
  await fixture.restartApi();
  const listed = await fixture.request(
    `${j.path}?bagId=${j.bagId}`,
    j.owner.token,
  );
  assert.equal(listed.data.records.length, 1);
  assert.equal(listed.data.records[0].file.id, saved.data.record.file.id);
  assert.equal(listed.headers.get("cache-control"), "private, no-store");
  assert.equal(JSON.stringify(listed.data).includes("object_key"), false);
});
async function admit(
  j: Awaited<ReturnType<typeof setup>>,
  name: string,
  tripRole = "member",
  familyRole?: string,
) {
  const person = await member(name);
  const invite = await fixture.request(
    `${j.trip}/invitations`,
    j.owner.token,
    {
      recipient: { kind: "username", value: name },
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
test("travel PDF attachments have their own family/audience and historical privacy; itinerary and shared bags grant no private file access", async () => {
  const j = await setup("attachment_owner"),
    other = await admit(j, "attachment_other", "organizer"),
    viewer = await admit(j, "attachment_viewer", "viewer");
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const upload = await begin(j, bytes, {
    kind: "attachment",
    bagId: undefined,
    fileName: "booking.pdf",
    mediaType: "application/pdf",
  });
  await put(upload.up, j.owner.token, bytes);
  assert.equal(
    (await fixture.request(`${upload.up}/finalize`, j.owner.token, {}, "POST"))
      .status,
    200,
  );
  assert.equal(
    (await fixture.request(`${j.trip}/itinerary`, other.token)).status,
    200,
  );
  assert.deepEqual(
    (await fixture.request(j.path, other.token)).data.records,
    [],
  );
  for (const suffix of [
    "",
    "/uploads",
    "/open",
    "/access",
    `/uploads/${upload.upload.id}/authorize`,
    `/uploads/${upload.upload.id}/finalize`,
  ]) {
    const method = suffix === "" || suffix === "/uploads" ? "GET" : "POST";
    assert.equal(
      (
        await fixture.request(
          upload.path + suffix,
          other.token,
          method === "POST" ? {} : undefined,
          method,
        )
      ).status,
      404,
      suffix,
    );
  }
  const shared = await fixture.request(
    `${upload.path}/visibility`,
    j.owner.token,
    { audience: "trip", requestId: randomUUID() },
    "POST",
  );
  assert.equal(shared.status, 200, fixture.logs());
  assert.equal(
    (await fixture.request(`${upload.path}/open`, other.token, {}, "POST"))
      .status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${upload.path}/open`,
        other.token,
        { version: 1 },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${upload.path}/access`,
        other.token,
        { version: 1 },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${upload.path}/visibility`,
        other.token,
        { audience: "family", requestId: randomUUID() },
        "POST",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await fixture.request(
        `${upload.path}/uploads`,
        viewer.token,
        {
          fileName: "x.pdf",
          mediaType: "application/pdf",
          byteSize: bytes.length,
          requestId: randomUUID(),
        },
        "POST",
      )
    ).status,
    403,
  );
  const projected = (await fixture.request(j.path, other.token)).data.records;
  assert.equal(projected.length, 1);
  assert.equal(projected[0].familyId, undefined);
  assert.equal(projected[0].bagId, undefined);
  assert.equal(JSON.stringify(projected).includes("object_key"), false);
  const photo = await begin(j, await image());
  assert.equal(
    (
      await fixture.request(
        `${j.family}/bags/${j.bagId}/visibility`,
        j.owner.token,
        { audience: "trip", requestId: randomUUID() },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${photo.path}/open`, other.token, {}, "POST"))
      .status,
    404,
  );
  assert.deepEqual(
    (await fixture.request(`${j.path}?bagId=${j.bagId}`, other.token)).data
      .records,
    [],
  );
  assert.equal(
    JSON.stringify(
      (await fixture.request(`${j.trip}/shared`, other.token)).data,
    ).includes(photo.record.id),
    false,
  );
});
test("sharing never reveals private pending uploads or authorizes their historical retries; current grants gate every operation", async () => {
  const j = await setup("upload_scope_owner"),
    other = await admit(j, "upload_scope_other"),
    editor = await admit(j, "upload_scope_editor", "member", "editor"),
    bytes = await image();
  const pending = await begin(j, bytes, {
    kind: "attachment",
    bagId: undefined,
    fileName: "private-booking.png",
  });
  await put(pending.up, j.owner.token, bytes);
  const share = { audience: "trip", requestId: randomUUID() };
  assert.equal(
    (
      await fixture.request(
        `${pending.path}/visibility`,
        j.owner.token,
        share,
        "POST",
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await fixture.request(`${pending.path}/uploads`, other.token)).data
      .uploads,
    [],
  );
  for (const action of ["authorize", "finalize"])
    assert.equal(
      (
        await fixture.request(
          `${pending.up}/${action}`,
          other.token,
          {},
          "POST",
        )
      ).status,
      404,
    );
  assert.equal(
    (await fixture.request(`${pending.up}/finalize`, editor.token, {}, "POST"))
      .status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.family}/members/${editor.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${pending.up}/finalize`, editor.token, {}, "POST"))
      .status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${pending.path}/visibility`,
        j.owner.token,
        { audience: "family", requestId: randomUUID() },
        "POST",
      )
    ).status,
    200,
  );
  // Old sharing receipt returns current metadata; it must never republish.
  const retry = await fixture.request(
    `${pending.path}/visibility`,
    j.owner.token,
    share,
    "POST",
  );
  assert.equal(retry.data.record.audience, "family");
  assert.equal(
    (await fixture.request(`${pending.path}/open`, other.token, {}, "POST"))
      .status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${pending.path}/access`,
        other.token,
        { version: 1 },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/members/${other.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal((await fixture.request(j.path, other.token)).status, 404);
});
test("replacement retries and concurrent finalizations keep one photo slot, preserve latest accepted content and independent bag fields", async () => {
  const j = await setup("file_retry_owner"),
    bytes = await image();
  const body = {
    kind: "bag_photo",
    bagId: j.bagId,
    familyId: j.familyId,
    fileName: "bag.png",
    mediaType: "image/png",
    byteSize: bytes.length,
    requestId: randomUUID(),
  };
  const created = await Promise.all([
    fixture.request(j.path, j.owner.token, body, "POST"),
    fixture.request(j.path, j.owner.token, body, "POST"),
  ]);
  assert.deepEqual(
    created.map((r) => r.status),
    [201, 201],
  );
  assert.equal(created[0].data.record.id, created[1].data.record.id);
  assert.equal(created[0].data.upload.id, created[1].data.upload.id);
  const id = created[0].data.record.id,
    path = `${j.path}/${id}`,
    up = `${path}/uploads/${created[0].data.upload.id}`;
  await put(up, j.owner.token, bytes);
  const saved = await Promise.all([
    fixture.request(`${up}/finalize`, j.owner.token, {}, "POST"),
    fixture.request(`${up}/finalize`, j.owner.token, {}, "POST"),
  ]);
  assert.deepEqual(
    saved.map((r) => r.status),
    [200, 200],
  );
  assert.deepEqual(
    saved.map((r) => r.data.record.version),
    [1, 1],
  );
  assert.equal(saved[0].data.record.file.id, saved[1].data.record.file.id);
  assert.equal(
    (
      await fixture.request(
        j.path,
        j.owner.token,
        { ...body, fileName: "changed.png" },
        "POST",
      )
    ).status,
    409,
  );
  const replacement = await begin(j, bytes, { fileName: "replacement.png" });
  assert.equal(replacement.record.id, id);
  assert.equal(replacement.record.file.id, saved[0].data.record.file.id);
  assert.equal(
    (
      await fixture.request(
        `${replacement.up}/finalize`,
        j.owner.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  const auth = await put(replacement.up, j.owner.token, bytes);
  storage.raceCopy(Buffer.alloc(bytes.length, 65));
  assert.equal(
    (
      await fixture.request(
        `${replacement.up}/finalize`,
        j.owner.token,
        {},
        "POST",
      )
    ).status,
    409,
  );
  await put(replacement.up, j.owner.token, bytes);
  storage.available(false);
  try {
    assert.equal(
      (
        await fixture.request(
          `${replacement.up}/finalize`,
          j.owner.token,
          {},
          "POST",
        )
      ).status,
      503,
    );
  } finally {
    storage.available(true);
  }
  const combined = await Promise.all([
    fixture.request(`${replacement.up}/finalize`, j.owner.token, {}, "POST"),
    fixture.request(
      `${j.family}/bags/${j.bagId}`,
      j.owner.token,
      { name: "Renamed bag", requestId: randomUUID() },
      "PATCH",
    ),
  ]);
  assert.deepEqual(
    combined.map((r) => r.status),
    [200, 200],
  );
  assert.equal(combined[0].data.record.version, 2);
  assert.equal(
    (await fixture.request(`${up}/finalize`, j.owner.token, {}, "POST")).data
      .record.file.id,
    combined[0].data.record.file.id,
  );
  assert.equal(
    (await fixture.request(`${up}/authorize`, j.owner.token, {}, "POST"))
      .status,
    409,
  );
  const latest = await fixture.request(
    `${j.path}?bagId=${j.bagId}`,
    j.owner.token,
  );
  assert.equal(latest.data.records.length, 1);
  assert.equal(latest.data.records[0].version, 2);
  assert.equal(
    (await fixture.request(`${j.family}/packing`, j.owner.token)).data.bags[0]
      .name,
    "Renamed bag",
  );
  assert.equal(
    (
      await fixture.request(
        `${path}/open`,
        j.owner.token,
        { version: 1 },
        "POST",
      )
    ).status,
    200,
  );
  assert.equal((await fetch(auth.url, { method: "GET" })).status, 403);
});
test("actual formats and 20 MB limits apply to photos and attachments without raw-body or key injection", async () => {
  const j = await setup("file_format_owner");
  for (const format of ["jpeg", "png", "webp"] as const) {
    const bytes = await image(format),
      uploaded = await begin(j, bytes, { mediaType: `image/${format}` });
    await put(uploaded.up, j.owner.token, bytes);
    const result = await fixture.request(
      `${uploaded.up}/finalize`,
      j.owner.token,
      {},
      "POST",
    );
    assert.equal(result.status, 200, fixture.logs());
    assert.equal(result.data.record.file.mediaType, `image/${format}`);
  }
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const pdfBytes = Buffer.from(await pdf.save());
  assert.equal(
    (
      await fixture.request(
        j.path,
        j.owner.token,
        {
          kind: "bag_photo",
          familyId: j.familyId,
          bagId: j.bagId,
          fileName: "bag.pdf",
          mediaType: "application/pdf",
          byteSize: pdfBytes.length,
          requestId: randomUUID(),
        },
        "POST",
      )
    ).status,
    422,
  );
  for (const bytes of [
    pdfBytes,
    Buffer.from("not an image"),
    (await image()).subarray(0, 40),
  ]) {
    const uploaded = await begin(j, bytes);
    await put(uploaded.up, j.owner.token, bytes);
    assert.equal(
      (
        await fixture.request(
          `${uploaded.up}/finalize`,
          j.owner.token,
          {},
          "POST",
        )
      ).status,
      422,
    );
  }
  const uploaded = await begin(j, await image());
  const authorization = await put(uploaded.up, j.owner.token, await image());
  storage.replaceUploadedObject(
    authorization.url,
    Buffer.alloc(20_000_001, 65),
  );
  assert.equal(
    (
      await fixture.request(
        `${uploaded.up}/finalize`,
        j.owner.token,
        {},
        "POST",
      )
    ).status,
    422,
  );
  const details = {
    fileName: "bag.png",
    mediaType: "image/png",
    byteSize: 98,
    requestId: randomUUID(),
  };
  for (const extra of [
    { byteSize: 20_000_001 },
    { objectKey: "another/private" },
    { mediaType: "image/gif" },
  ]) {
    assert.equal(
      (
        await fixture.request(
          `${uploaded.path}/uploads`,
          j.owner.token,
          { ...details, ...extra },
          "POST",
        )
      ).status,
      422,
    );
  }
  assert.equal(
    (
      await fixture.request(
        `${uploaded.path}/open`,
        j.owner.token,
        { key: "another/private" },
        "POST",
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await fixture.request(
        `${uploaded.path}/uploads/${randomUUID()}/authorize`,
        j.owner.token,
        {},
        "POST",
      )
    ).status,
    404,
  );
  const raw = await fetch(`${fixture.url}${uploaded.up}/finalize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${j.owner.token}`,
      "Content-Type": "image/png",
    },
    body: new Uint8Array(await image()),
  });
  assert.equal(raw.status, 415);
});
test("two families keep record ownership, crossed bag/trip IDs and removed itinerary parents inaccessible", async () => {
  const j = await setup("file_families_owner"),
    other = await admit(j, "file_families_other", "organizer"),
    bytes = await image();
  const otherFamily = await fixture.request(
    `${j.trip}/families`,
    other.token,
    { name: "Second private family", requestId: randomUUID() },
    "POST",
  );
  assert.equal(otherFamily.status, 201, fixture.logs());
  const familyId = otherFamily.data.family.id as string;
  const details = {
    kind: "attachment",
    familyId,
    fileName: "other.png",
    mediaType: "image/png",
    byteSize: bytes.length,
    requestId: randomUUID(),
  };
  const second = await fixture.request(j.path, other.token, details, "POST");
  assert.equal(second.status, 201, fixture.logs());
  assert.equal(
    (await fixture.request(`${j.path}/${second.data.record.id}`, j.owner.token))
      .status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        j.path,
        other.token,
        {
          ...details,
          kind: "bag_photo",
          bagId: j.bagId,
          requestId: randomUUID(),
        },
        "POST",
      )
    ).status,
    404,
  );
  const entry = await fixture.request(
    `${j.trip}/itinerary/entries`,
    j.owner.token,
    { kind: "stop", title: "Makkah", requestId: randomUUID() },
    "POST",
  );
  assert.equal(entry.status, 201, fixture.logs());
  const upload = await begin(j, bytes, {
    kind: "attachment",
    bagId: undefined,
    entryId: entry.data.entry.id,
  });
  await put(upload.up, j.owner.token, bytes);
  assert.equal(
    (await fixture.request(`${upload.up}/finalize`, j.owner.token, {}, "POST"))
      .status,
    200,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.path}?entryId=${entry.data.entry.id}`,
        j.owner.token,
      )
    ).data.records.length,
    1,
  );
  assert.deepEqual(
    (
      await fixture.request(
        `${j.path}?entryId=${entry.data.entry.id}`,
        other.token,
      )
    ).data.records,
    [],
  );
  const foreign = await setup("file_foreign_owner");
  assert.equal(
    (
      await fixture.request(
        `${foreign.path}/${upload.record.id}/open`,
        foreign.owner.token,
        {},
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        foreign.path,
        foreign.owner.token,
        {
          ...details,
          familyId: foreign.familyId,
          entryId: entry.data.entry.id,
          requestId: randomUUID(),
        },
        "POST",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fixture.request(
        `${j.trip}/itinerary/entries/${entry.data.entry.id}`,
        j.owner.token,
        undefined,
        "DELETE",
      )
    ).status,
    200,
  );
  for (const suffix of [
    "/open",
    "/access",
    `/uploads/${upload.upload.id}/finalize`,
  ])
    assert.equal(
      (
        await fixture.request(
          upload.path + suffix,
          j.owner.token,
          { ...(suffix === "/access" ? { version: 1 } : {}) },
          "POST",
        )
      ).status,
      404,
    );
  const photo = await begin(j, bytes);
  await put(photo.up, j.owner.token, bytes);
  await fixture.request(`${photo.up}/finalize`, j.owner.token, {}, "POST");
  assert.equal(
    (
      await fixture.request(
        `${j.family}/bags/${j.bagId}`,
        j.owner.token,
        { requestId: randomUUID(), reason: "Bag removed" },
        "DELETE",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fixture.request(`${photo.path}/open`, j.owner.token, {}, "POST"))
      .status,
    404,
  );
  assert.equal(
    (await fixture.request(`${photo.up}/finalize`, j.owner.token, {}, "POST"))
      .status,
    404,
  );
});
