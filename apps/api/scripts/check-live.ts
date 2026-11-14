import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClerkClient } from "@clerk/backend";
import { PDFDocument } from "pdf-lib";
import {
  accountResponse,
  tripResponse,
  invitationResponse,
  checklistEntryResponse,
  checklistCategoryResponse,
  packingResponse,
  returnPreparationResponse,
  familyResponse,
  travelerResponse,
  uploadResponse,
  fileAuthorization,
  openFileResponse,
} from "@nmt/contracts";

// Real Clerk/Neon/R2 through HTTP. Admin-created development identities are
// deliberately not email-delivery, Google linking or physical-device evidence.
const origin = new URL(process.argv[2]);
assert.equal(process.argv[3], "--development-fixtures");
const retainForRecovery = process.argv[4] === "--retain-for-recovery";
assert.ok(process.argv[4] === undefined || retainForRecovery);
assert.ok(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"));
assert.ok(!process.env.CLERK_API_URL && !process.env.EXPO_PUSH_API_URL);
assert.ok(
  origin.protocol === "https:" ||
    (origin.protocol === "http:" && origin.hostname === "127.0.0.1"),
);
assert.equal(origin.pathname, "/");
assert.ok(
  !origin.username && !origin.password && !origin.search && !origin.hash,
);
const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});
const runId = `nmt22_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
type Person = {
  clerkId: string;
  sessionId: string;
  memberId: string;
  username: string;
};
const people: Person[] = [];
const inventory: {
  runId: string;
  origin: string;
  users: { id: string; username: string }[];
  trips: string[];
  retainedObjectPaths: string[];
  passed: string[];
  recovery?: {
    tripId: string;
    family: string;
    entryId: string;
    guide: string;
    sha256: string;
    ownerMemberId: string;
  };
} = {
  runId,
  origin: origin.origin,
  users: [],
  trips: [],
  retainedObjectPaths: [],
  passed: [],
};
const directory = resolve(".local/release-checks", runId);
await mkdir(directory, { recursive: true });
const record = () =>
  writeFile(
    resolve(directory, "evidence.json"),
    JSON.stringify(inventory, null, 2) + "\n",
  );
let phase = "create explicitly owned development identities";

async function request(
  person: Person | null,
  path: string,
  status = 200,
  method = "GET",
  body?: unknown,
) {
  const token = person
    ? (await clerk.sessions.getToken(person.sessionId)).jwt
    : undefined;
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  assert.equal(response.status, status, `${method} ${path}: unexpected status`);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response.json() as Promise<unknown>;
}
async function person(suffix: string) {
  const username = `${runId}_${suffix}`;
  const created = await clerk.users.createUser({
    emailAddress: [`${username}+clerk_test@example.com`],
    privateMetadata: { nmtReleaseCheck: runId },
  });
  inventory.users.push({ id: created.id, username });
  await record();
  const session = await clerk.sessions.createSession({ userId: created.id });
  const value: Person = {
    clerkId: created.id,
    sessionId: session.id,
    memberId: "",
    username,
  };
  people.push(value);
  const me = accountResponse.parse(
    await request(value, "/api/me", 200, "PUT", {
      firstName: "Release",
      lastName: "Fixture",
      username,
    }),
  );
  assert.ok(me.profile);
  value.memberId = me.profile.id;
  return value;
}
async function admit(
  owner: Person,
  member: Person,
  trip: string,
  familyId: string,
) {
  const offer = invitationResponse.parse(
    await request(owner, `${trip}/invitations`, 201, "POST", {
      recipient: { kind: "username", value: member.username },
      tripRole: "member",
      familyId,
      familyRole: "editor",
    }),
  );
  await request(
    member,
    `/api/invitations/${offer.invitation.id}/accept`,
    200,
    "POST",
    {},
  );
}

try {
  const owner = await person("owner");
  const editor = await person("editor");
  const other = await person("other");
  phase = "private trip and two-family admission";
  const created = tripResponse.parse(
    await request(owner, "/api/trips", 201, "POST", {
      requestId: randomUUID(),
      name: runId,
      kind: "umrah",
      startDate: "2026-11-20",
      endDate: "2026-12-04",
      destinations: ["Makkah"],
      familyName: "Release family A",
    }),
  );
  const trip = `/api/trips/${created.trip.id}`;
  inventory.trips.push(created.trip.id);
  await record();
  const familyId = created.families[0].id;
  const family = `${trip}/families/${familyId}`;
  const second = familyResponse.parse(
    await request(owner, `${trip}/families`, 201, "POST", {
      name: "Release family B",
      requestId: randomUUID(),
    }),
  );
  const secondId = second.family.id;
  await admit(owner, editor, trip, familyId);
  await admit(owner, other, trip, secondId);
  await request(other, `${family}/checklist`, 404);
  await request(null, trip, 401);
  inventory.passed.push("real-clerk-sessions-two-family-isolation");

  phase = "quantity and outbound packing";
  const category = checklistCategoryResponse.parse(
    await request(owner, `${family}/checklist/categories`, 201, "POST", {
      name: "Release essentials",
    }),
  );
  const entry = checklistEntryResponse.parse(
    await request(owner, `${family}/checklist/entries`, 201, "POST", {
      requestId: randomUUID(),
      kind: "item",
      title: "Disposable test adapters",
      categoryId: category.category.id,
      requiredQuantity: 4,
      unit: "pieces",
      beneficiaries: { kind: "family" },
      responsibleMemberId: owner.memberId,
    }),
  );
  const entryPath = `${family}/checklist/entries/${entry.entry.id}`;
  const receipt = {
    requestId: randomUUID(),
    kind: "move",
    from: "remaining",
    to: "received",
    quantity: 3,
    physicalConfirmed: true,
  };
  await request(owner, `${entryPath}/acquisition`, 200, "POST", receipt);
  const retried = checklistEntryResponse.parse(
    await request(owner, `${entryPath}/acquisition`, 200, "POST", receipt),
  );
  assert.equal(retried.entry.kind, "item");
  if (retried.entry.kind !== "item") throw Error("Expected item");
  assert.ok(retried.entry.acquisition);
  assert.equal(retried.entry.acquisition.available, 3);
  assert.equal(retried.entry.acquisition.remainingToBeReady, 1);
  const traveler = travelerResponse.parse(
    await request(owner, `${family}/travelers`, 201, "POST", {
      firstName: "Release",
      lastName: "Traveler",
      requestId: randomUUID(),
    }),
  );
  const bags = packingResponse.parse(
    await request(owner, `${family}/bags`, 201, "POST", {
      requestId: randomUUID(),
      name: "Task-owned suitcase",
      type: "Checked",
      carrierTravelerId: traveler.traveler.id,
    }),
  );
  const bag = bags.bags[0];
  const move = {
    requestId: randomUUID(),
    kind: "move",
    leg: "outbound",
    entryId: entry.entry.id,
    from: { kind: "unpacked" },
    to: { kind: "bag", id: bag.id },
    quantity: 4,
    physicalConfirmed: true,
  };
  await request(editor, `${family}/packing`, 409, "POST", move);
  const packed = packingResponse.parse(
    await request(editor, `${family}/packing`, 200, "POST", {
      ...move,
      requestId: randomUUID(),
      quantity: 2,
    }),
  );
  assert.equal(packed.items[0].packed, 2);
  assert.equal(packed.items[0].notPacked, 1);
  inventory.passed.push(
    "receipt-idempotency-and-available-stock-packing-constraint",
  );

  phase = "independent return reconciliation";
  const proposed = returnPreparationResponse.parse(
    await request(owner, `${family}/return-preparation`, 200, "POST", {
      requestId: randomUUID(),
      kind: "propose",
    }),
  );
  assert.equal(proposed.items[0].possessionQuantity, 0);
  assert.equal(proposed.items[0].reviewed, false);
  await request(owner, `${family}/return-preparation`, 200, "POST", {
    requestId: randomUUID(),
    kind: "reconcile",
    entryId: entry.entry.id,
    fields: { requiredQuantity: 2, possessionQuantity: 2 },
    reason: "Task-owned synthetic checkout",
    reviewConfirmed: true,
    physicalConfirmed: true,
  });
  const outbound = packingResponse.parse(
    await request(owner, `${family}/packing`),
  );
  assert.equal(outbound.items[0].packed, 2);
  inventory.passed.push("return-starts-unconfirmed-and-preserves-outbound");

  phase = "private file upload and immutable validation";
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Task-owned release provider check");
  const bytes = Buffer.from(await pdf.save());
  const guides = `${trip}/guides`;
  const upload = uploadResponse.parse(
    await request(owner, `${guides}/uploads`, 201, "POST", {
      title: "Disposable release guide",
      category: "Travel",
      familyId,
      fileName: "release.pdf",
      mediaType: "application/pdf",
      byteSize: bytes.length,
      requestId: randomUUID(),
    }),
  );
  const guidePath = `${guides}/${upload.guide.id}`;
  const uploadPath = `${guidePath}/uploads/${upload.upload.id}`;
  const signed = fileAuthorization.parse(
    await request(owner, `${uploadPath}/authorize`, 200, "POST", {}),
  );
  const put = await fetch(signed.url, {
    method: "PUT",
    headers: signed.headers,
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(put.status, 200);
  await put.body?.cancel();
  await request(owner, `${uploadPath}/finalize`, 200, "POST", {});
  const opened = openFileResponse.parse(
    await request(editor, `${guidePath}/open`, 200, "POST", {}),
  );
  const objectPath = new URL(opened.authorization.url).pathname;
  inventory.retainedObjectPaths.push(objectPath);
  await record();
  const read = await fetch(opened.authorization.url, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(read.status, 200);
  const digest = (value: Uint8Array) =>
    createHash("sha256").update(value).digest("hex");
  assert.equal(digest(new Uint8Array(await read.arrayBuffer())), digest(bytes));
  await request(other, `${guidePath}/open`, 404, "POST", {});
  await request(owner, `${family}/members/${editor.memberId}`, 200, "DELETE");
  await request(editor, `${guidePath}/open`, 404, "POST", {});
  await request(editor, `${family}/packing`, 404);
  inventory.passed.push(
    "real-r2-private-upload-finalize-read-and-current-access-revocation",
  );

  phase = "last-administrator and safe account removal";
  await request(owner, "/api/me/removal", 409, "POST", {
    requestId: randomUUID(),
    confirmation: "Remove my account",
  });
  if (retainForRecovery) {
    inventory.recovery = {
      tripId: created.trip.id,
      family,
      entryId: entry.entry.id,
      guide: guidePath,
      sha256: digest(bytes),
      ownerMemberId: owner.memberId,
    };
    inventory.passed.push("retained-owned-fixtures-for-server-recovery");
  } else {
    await request(owner, trip, 200, "DELETE", {
      requestId: randomUUID(),
      confirmation: "Delete trip",
    });
    for (const value of people) {
      // Every identity was created above, recorded before use, and is checked
      // against its task marker before the application's provider-deletion path.
      const current = await clerk.users.getUser(value.clerkId);
      assert.equal(current.privateMetadata.nmtReleaseCheck, runId);
      await request(value, "/api/me/removal", 200, "POST", {
        requestId: randomUUID(),
        confirmation: "Remove my account",
      });
    }
    inventory.passed.push(
      "last-admin-block-explicit-owned-trip-deletion-and-real-provider-removal",
    );
  }
  console.log(
    JSON.stringify({
      runId,
      passed: inventory.passed,
      evidence: directory,
      retainedObjectPaths: inventory.retainedObjectPaths,
      limits:
        "Development admin-created identities; no mailbox/Google/physical or Vercel deployment acceptance. Existing signed file URLs can remain valid for up to 120 seconds. Object retention is deliberate.",
    }),
  );
} catch (error) {
  console.error(
    `Live check stopped during ${phase}; owned fixture inventory: ${directory}`,
  );
  if (error instanceof assert.AssertionError)
    console.error(
      `Assertion ${error.operator}; expected status/value ${String(error.expected)}, observed ${String(error.actual)}.`,
    );
  process.exitCode = 1;
} finally {
  await record();
}
