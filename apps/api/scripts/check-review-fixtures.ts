// Disposable real-provider fixtures for docs/review-fixes.md. Never production identities.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClerkClient } from "@clerk/backend";
import { PDFDocument, StandardFonts } from "pdf-lib";

assert.ok(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"));
assert.ok(!process.env.CLERK_API_URL);
const command = process.argv[2];
const directory = resolve(".local/review-native");
await mkdir(directory, { recursive: true });
const inventoryPath = resolve(directory, "inventory.json");
type Person = { id: string; session: string; member: string; username: string };
type Inventory = {
  marker: string;
  origin: string;
  people: Person[];
  trips: string[];
  refs: Record<string, string>;
  cleaned?: string;
};
const e: Inventory =
  command === "seed"
    ? {
        marker: `nmtr_${randomUUID().slice(0, 8)}`,
        origin: process.argv[3],
        people: [],
        trips: [],
        refs: {},
      }
    : JSON.parse(await readFile(inventoryPath, "utf8"));
assert.equal(new URL(e.origin).hostname, "127.0.0.1");
const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});
const record = () => writeFile(inventoryPath, JSON.stringify(e, null, 2));
async function request(
  person: Person,
  path: string,
  method = "GET",
  body?: unknown,
  status = 200,
): Promise<any> {
  const jwt = (await clerk.sessions.getToken(person.session)).jwt;
  const response = await fetch(new URL(path, e.origin), {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${JSON.stringify(data)}`,
  );
  return data;
}
async function person(suffix: string) {
  const username = `${e.marker}_${suffix}`;
  const user = await clerk.users.createUser({
    emailAddress: [`${username}+clerk_test@example.com`],
    privateMetadata: { nmtReviewCheck: e.marker },
  });
  const p = { id: user.id, session: "", member: "", username };
  e.people.push(p);
  await record();
  p.session = (await clerk.sessions.createSession({ userId: user.id })).id;
  await record();
  p.member = (
    await request(p, "/api/me", "PUT", {
      firstName: "Review",
      lastName: suffix,
      username,
    })
  ).profile.id;
  await record();
  return p;
}
async function trip(p: Person, suffix: string) {
  const saved = await request(
    p,
    "/api/trips",
    "POST",
    {
      name: `${e.marker} ${suffix}`,
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: `${suffix} own family`,
    },
    201,
  );
  e.trips.push(saved.trip.id);
  await record();
  return saved;
}
async function entry(p: Person, family: string, title: string) {
  const c = await request(
    p,
    `${family}/checklist/categories`,
    "POST",
    { name: "Review supplies", requestId: randomUUID() },
    201,
  );
  const saved = await request(
    p,
    `${family}/checklist/entries`,
    "POST",
    {
      categoryId: c.category.id,
      kind: "task",
      title,
      taskStatus: "to_do",
      requiredQuantity: null,
      unit: "",
      responsibleMemberId: p.member,
      beneficiaries: { kind: "family" },
      leg: "both",
    },
    201,
  );
  return `${family}/checklist/entries/${saved.entry.id}`;
}
async function visibility(p: Person, path: string, audience: string) {
  return request(p, `${path}/visibility`, "POST", {
    requestId: randomUUID(),
    audience,
  });
}
if (command === "seed" || command === "resume") {
  const native = command === "seed" ? await person("native") : e.people[0];
  const owner = command === "seed" ? await person("owner") : e.people[1];
  if (command === "seed") {
    const a = await trip(native, "A"),
      b = await trip(native, "B");
    e.refs.a = `/api/trips/${a.trip.id}`;
    e.refs.b = `/api/trips/${b.trip.id}`;
    e.refs.af = `${e.refs.a}/families/${a.families[0].id}`;
    e.refs.bf = `${e.refs.b}/families/${b.families[0].id}`;
    e.refs.deleteA = await entry(native, e.refs.af, "Disposable A record");
    e.refs.editB = await entry(native, e.refs.bf, "Keep B draft");
    e.refs.deleteB = await entry(
      native,
      e.refs.bf,
      "Disposable B other record",
    );
    const offered = await request(
      native,
      `${e.refs.a}/invitations`,
      "POST",
      {
        recipient: { kind: "username", value: owner.username },
        tripRole: "organizer",
      },
      201,
    );
    await request(
      owner,
      `/api/invitations/${offered.invitation.id}/accept`,
      "POST",
      {},
    );
    const family = await request(
      owner,
      `${e.refs.a}/families`,
      "POST",
      { name: "Other private family" },
      201,
    );
    e.refs.otherFamily = `${e.refs.a}/families/${family.family.id}`;
    await record();
    e.refs.shared = await entry(
      owner,
      e.refs.otherFamily,
      "Revocable both-leg task",
    );
    e.refs.retained = await entry(
      owner,
      e.refs.otherFamily,
      "Retained both-leg task",
    );
    await visibility(owner, e.refs.shared, "trip");
    await visibility(owner, e.refs.retained, "trip");
    const traveler = await request(
      owner,
      `${e.refs.otherFamily}/travelers`,
      "POST",
      { firstName: "Review", lastName: "Carrier" },
      201,
    );
    const bag = await request(
      owner,
      `${e.refs.otherFamily}/bags`,
      "POST",
      {
        requestId: randomUUID(),
        name: "Revocable both-leg bag",
        type: "checked",
        carrierTravelerId: traveler.traveler.id,
        identifyingNote: "Private note",
        weightNote: "",
        allowanceNote: "",
      },
      201,
    );
    e.refs.bag = `${e.refs.otherFamily}/bags/${bag.bags.find((b: any) => b.name === "Revocable both-leg bag").id}`;
    await visibility(owner, e.refs.bag, "trip");
    await record();
  } else {
    const shared = await request(owner, `${e.refs.a}/shared`);
    e.refs.shared = `${e.refs.otherFamily}/checklist/entries/${shared.items.find((i: any) => i.entry.title === "Revocable both-leg task").entry.id}`;
    e.refs.retained = `${e.refs.otherFamily}/checklist/entries/${shared.items.find((i: any) => i.entry.title === "Retained both-leg task").entry.id}`;
    const packing = await request(owner, `${e.refs.otherFamily}/packing`);
    e.refs.bag = `${e.refs.otherFamily}/bags/${packing.bags.find((b: any) => b.name === "Revocable both-leg bag").id}`;
    await visibility(owner, e.refs.bag, "trip");
    await record();
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("NMT review unsaved private PDF", {
    x: 50,
    y: 700,
    size: 18,
    font,
  });
  const bytes = await pdf.save();
  await writeFile(resolve(directory, "review.pdf"), bytes);
  for (let version = 1; version <= 2; version++) {
    const details = {
      requestId: randomUUID(),
      fileName: "review.pdf",
      mediaType: "application/pdf",
      byteSize: bytes.length,
    };
    const upload = await request(
      owner,
      version === 1 ? `${e.refs.a}/guides/uploads` : `${e.refs.guide}/uploads`,
      "POST",
      version === 1
        ? {
            ...details,
            familyId: e.refs.otherFamily.split("/").at(-1),
            title: "Revocable unsaved PDF",
            category: "Review",
            description: "",
            source: "",
          }
        : details,
      201,
    );
    e.refs.guide = `${e.refs.a}/guides/${upload.guide.id}`;
    await record();
    const auth = await request(
      owner,
      `${e.refs.guide}/uploads/${upload.upload.id}/authorize`,
      "POST",
      {},
    );
    assert.ok(
      (
        await fetch(auth.url, {
          method: "PUT",
          headers: auth.headers,
          body: bytes,
        })
      ).ok,
    );
    await request(
      owner,
      `${e.refs.guide}/uploads/${upload.upload.id}/finalize`,
      "POST",
      {},
    );
  }
  await request(owner, e.refs.guide, "PATCH", {
    requestId: randomUUID(),
    audience: "trip",
  });
  await record();
  console.log(
    JSON.stringify({
      inventoryPath,
      email: `${native.username}+clerk_test@example.com`,
      marker: e.marker,
      refs: e.refs,
    }),
  );
} else {
  for (const p of e.people)
    assert.equal(
      (await clerk.users.getUser(p.id)).privateMetadata.nmtReviewCheck,
      e.marker,
    );
  const [native, owner] = e.people;
  if (command === "revoke-shared") {
    await visibility(owner, e.refs.shared, "family");
    await visibility(owner, e.refs.bag, "family");
  } else if (command === "restore-shared") {
    await visibility(owner, e.refs.shared, "trip");
    await visibility(owner, e.refs.bag, "trip");
  } else if (command === "revoke-guide" || command === "restore-guide")
    await request(owner, e.refs.guide, "PATCH", {
      requestId: randomUUID(),
      audience: command === "revoke-guide" ? "family" : "trip",
    });
  else if (command === "delete-A" || command === "delete-B")
    await request(
      native,
      e.refs[command === "delete-A" ? "deleteA" : "deleteB"],
      "DELETE",
    );
  else if (command === "reset-records") {
    e.refs.deleteA = await entry(native, e.refs.af, "Disposable A record");
    e.refs.deleteB = await entry(
      native,
      e.refs.bf,
      "Disposable B other record",
    );
    await record();
  } else if (command === "verify-draft") {
    const checklist = await request(native, `${e.refs.bf}/checklist`);
    assert.equal(
      checklist.entries.find(
        (entry: any) => entry.id === e.refs.editB.split("/").at(-1),
      ).title,
      "Keep B draft",
    );
    console.log("PASS: reconnect did not submit the native draft");
  } else if (command === "capture-red-upload") {
    const events = (await readFile(resolve(directory, "network.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const authorized = events.findLast(
      (event) =>
        event.path?.includes("/guides/") && event.path.endsWith("/authorize"),
    );
    assert.ok(authorized?.path.startsWith(e.refs.b));
    e.refs.redGuide = authorized.path.split("/uploads/")[0];
    const current = await request(native, e.refs.redGuide);
    assert.equal(current.guide.version, 2);
    assert.ok(current.guide.file);
    await record();
    console.log(
      JSON.stringify({
        guide: current.guide.id,
        version: current.guide.version,
        file: current.guide.file.id,
        accepted: true,
      }),
    );
  } else if (
    command === "change-recovery-guide" ||
    command === "change-recovery-travel"
  ) {
    const kind =
      command === "change-recovery-guide" ? "guides" : "travel-files";
    const events = (await readFile(resolve(directory, "network.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const accepted = events.findLast(
      (event) =>
        event.decision === "lost-accepted-finalize" &&
        event.path.includes(`/${kind}/`),
    );
    assert.ok(accepted?.path.startsWith(e.refs.b));
    assert.equal(accepted.version, kind === "guides" ? 2 : 1);
    const path = accepted.path.split("/uploads/")[0];
    e.refs[kind === "guides" ? "greenGuide" : "greenTravel"] = path;
    if (kind === "guides") {
      const current = await request(native, path);
      assert.equal(current.guide.title, "Recovery green");
      await request(native, path, "PATCH", {
        requestId: randomUUID(),
        title: "Recovery green current",
        audience: "trip",
      });
    } else
      await request(native, `${path}/visibility`, "POST", {
        requestId: randomUUID(),
        audience: "trip",
      });
    await record();
    console.log(
      JSON.stringify({
        currentMetadataAdvanced: kind,
        acceptedFile: accepted.file,
        acceptedVersion: accepted.version,
      }),
    );
  } else if (
    command === "verify-recovery-guide" ||
    command === "verify-recovery-travel"
  ) {
    const guide = command === "verify-recovery-guide";
    const path = e.refs[guide ? "greenGuide" : "greenTravel"];
    const result = await request(
      native,
      guide ? path : `${e.refs.b}/travel-files`,
    );
    const value = guide
      ? result.guide
      : result.records.find(
          (record: any) => record.id === path.split("/").at(-1),
        );
    assert.equal(value.version, guide ? 3 : 2);
    assert.equal(value.audience, "trip");
    if (guide) {
      assert.equal(value.title, "Recovery green current");
      const history = await request(native, `${path}/history`);
      assert.equal(
        history.versions.filter((version: any) =>
          version.changedFields.includes("file"),
        ).length,
        1,
      );
      assert.equal(
        new Set(
          history.versions
            .filter((version: any) => version.guide.file)
            .map((version: any) => version.guide.file.id),
        ).size,
        1,
      );
    }
    const uploads = await request(native, `${path}/uploads`);
    assert.equal(uploads.uploads.length, 0);
    console.log(
      JSON.stringify({
        confirmed: command,
        version: value.version,
        file: value.file.id,
        audience: value.audience,
        pending: 0,
      }),
    );
  } else if (command === "verify-revoked-guide") {
    await request(native, e.refs.a);
    await request(native, e.refs.guide, "GET", undefined, 404);
    await request(
      native,
      `${e.refs.guide}/copy-access`,
      "POST",
      { version: 4 },
      404,
    );
    console.log(
      "PASS: trip membership retained; current guide and exact shared historical version denied",
    );
  } else if (command === "grant-guide-family") {
    const offered = await request(
      owner,
      `${e.refs.a}/invitations`,
      "POST",
      {
        recipient: { kind: "username", value: native.username },
        tripRole: "organizer",
        familyId: e.refs.otherFamily.split("/").at(-1),
        familyRole: "editor",
      },
      201,
    );
    await request(
      native,
      `/api/invitations/${offered.invitation.id}/accept`,
      "POST",
      {},
    );
  } else if (command === "revoke-guide-family") {
    await request(
      owner,
      `${e.refs.otherFamily}/members/${native.member}`,
      "DELETE",
    );
    await request(native, e.refs.guide);
    await request(
      native,
      `${e.refs.guide}/copy-access`,
      "POST",
      { version: 2 },
      404,
    );
    console.log(
      "PASS: current shared guide still permitted; exact private historical version denied",
    );
  } else if (command === "cleanup") {
    for (const id of e.trips) {
      const t = await request(native, `/api/trips/${id}`);
      assert.ok(t.trip.name.startsWith(e.marker));
      const other = await request(
        owner,
        `/api/trips/${id}`,
        "GET",
        undefined,
        id === e.trips[0] ? 200 : 404,
      );
      for (const f of other.families ?? []) {
        assert.equal(f.name, "Other private family");
        assert.equal(f.canCoordinate, true);
        await request(owner, `/api/trips/${id}/families/${f.id}`, "DELETE", {
          requestId: randomUUID(),
          confirmation: "Delete family",
        });
      }
      await request(native, `/api/trips/${id}`, "DELETE", {
        requestId: randomUUID(),
        confirmation: "Delete trip",
      });
    }
    for (const p of [owner, native])
      await request(p, "/api/me/removal", "POST", {
        requestId: randomUUID(),
        confirmation: "Remove my account",
      });
    e.cleaned = new Date().toISOString();
    await record();
  } else throw Error("Unknown fixture action");
  console.log(
    JSON.stringify({
      command,
      marker: e.marker,
      completedAt: new Date().toISOString(),
    }),
  );
}
