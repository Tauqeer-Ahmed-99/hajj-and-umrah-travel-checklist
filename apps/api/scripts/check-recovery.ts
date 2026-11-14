import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import {
  accountResponse,
  tripResponse,
  packingResponse,
  returnPreparationResponse,
  openFileResponse,
} from "@nmt/contracts";

// Restored server reads, not a client cache check. Only a check-live inventory
// explicitly retained for recovery can authorize source deletion here.
assert.ok(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"));
assert.ok(!process.env.CLERK_API_URL);
const [action, path, restoredOrigin] = process.argv.slice(2);
assert.ok(action === "delete-source" || action === "verify");
const evidence: {
  runId: string;
  origin: string;
  users: { id: string; username: string }[];
  recovery: {
    tripId: string;
    family: string;
    entryId: string;
    guide: string;
    sha256: string;
    ownerMemberId: string;
  };
  sourceDeletedAt?: string;
  restoredVerifiedAt?: string;
  restoredOrigin?: string;
} = JSON.parse(await readFile(path, "utf8"));
assert.match(evidence.runId, /^nmt22_[a-f0-9]{12}$/);
assert.ok(evidence.recovery && evidence.users.length === 3);
const trip = `/api/trips/${evidence.recovery.tripId}`;
assert.match(evidence.recovery.tripId, /^[a-f0-9-]{36}$/);
assert.ok(evidence.recovery.family.startsWith(trip + "/families/"));
assert.ok(evidence.recovery.guide.startsWith(trip + "/guides/"));
const source = new URL(evidence.origin);
function validateOrigin(url: URL) {
  assert.ok(
    url.protocol === "https:" ||
      (url.protocol === "http:" && url.hostname === "127.0.0.1"),
  );
  assert.ok(
    url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
  );
}
validateOrigin(source);
const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});
const sessions: string[] = [];
for (const user of evidence.users) {
  assert.ok(user.username.startsWith(evidence.runId + "_"));
  const current = await clerk.users.getUser(user.id);
  assert.equal(current.privateMetadata.nmtReleaseCheck, evidence.runId);
  sessions.push((await clerk.sessions.createSession({ userId: user.id })).id);
}
async function request(
  origin: URL,
  person: number,
  route: string,
  status = 200,
  method = "GET",
  body?: unknown,
) {
  const token = (await clerk.sessions.getToken(sessions[person])).jwt;
  const response = await fetch(new URL(route, origin), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  });
  assert.equal(
    response.status,
    status,
    `${method} ${route}: recovery HTTP check failed`,
  );
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response.json();
}
if (action === "delete-source") {
  assert.equal(
    restoredOrigin,
    "--confirmed-isolated-recovery-point",
    "Create and record the task-owned Neon recovery point first.",
  );
  assert.ok(!evidence.sourceDeletedAt, "Source deletion already recorded.");
  const current = tripResponse.parse(await request(source, 0, trip));
  assert.equal(current.trip.name, evidence.runId);
  await request(source, 0, trip, 200, "DELETE", {
    requestId: randomUUID(),
    confirmation: "Delete trip",
  });
  await request(source, 0, trip, 404);
  evidence.sourceDeletedAt = new Date().toISOString();
  console.log(
    `Deleted only source trip ${evidence.recovery.tripId}; retained its marked identities for restored authorization checks.`,
  );
} else {
  assert.ok(
    evidence.sourceDeletedAt,
    "Source deletion must be independently observed before verifying recovery.",
  );
  const restored = new URL(restoredOrigin);
  validateOrigin(restored);
  assert.notEqual(restored.origin, source.origin);
  await request(source, 0, trip, 404);
  const current = tripResponse.parse(await request(restored, 0, trip));
  assert.equal(current.trip.name, evidence.runId);
  const me = accountResponse.parse(await request(restored, 0, "/api/me"));
  assert.equal(me.profile?.id, evidence.recovery.ownerMemberId);
  const packing = packingResponse.parse(
    await request(restored, 0, `${evidence.recovery.family}/packing`),
  );
  const item = packing.items.find(
    (value) => value.entryId === evidence.recovery.entryId,
  );
  assert.ok(item);
  assert.equal(item.available, 3);
  assert.equal(item.packed, 2);
  const returning = returnPreparationResponse.parse(
    await request(
      restored,
      0,
      `${evidence.recovery.family}/return-preparation`,
    ),
  );
  const returned = returning.items.find(
    (value) => value.entryId === evidence.recovery.entryId,
  );
  assert.ok(returned);
  assert.equal(returned.possessionQuantity, 2);
  assert.equal(returned.reviewed, true);
  const open = openFileResponse.parse(
    await request(
      restored,
      0,
      `${evidence.recovery.guide}/open`,
      200,
      "POST",
      {},
    ),
  );
  const response = await fetch(open.authorization.url, {
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200);
  assert.equal(
    createHash("sha256")
      .update(new Uint8Array(await response.arrayBuffer()))
      .digest("hex"),
    evidence.recovery.sha256,
  );
  for (const person of [1, 2]) {
    await request(
      restored,
      person,
      `${evidence.recovery.guide}/open`,
      404,
      "POST",
      {},
    );
    await request(restored, person, `${evidence.recovery.family}/packing`, 404);
  }
  evidence.restoredVerifiedAt = new Date().toISOString();
  evidence.restoredOrigin = restored.origin;
  console.log(
    JSON.stringify({
      runId: evidence.runId,
      passed: [
        "source-trip-absent",
        "restored-member-trip-stock-outbound-return",
        "fresh-authorized-r2-bytes-match",
        "restored-family-isolation-and-revocation",
      ],
      source: source.origin,
      restored: restored.origin,
      sha256: evidence.recovery.sha256,
      limits:
        "Server recovery in isolated resources; not physical/native acceptance or proof of a long-term off-provider backup.",
    }),
  );
}
await writeFile(path, JSON.stringify(evidence, null, 2) + "\n");
