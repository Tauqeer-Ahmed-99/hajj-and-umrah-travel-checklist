import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { tripResponse } from "@nmt/contracts";

// Explicit recovery for an interrupted check-live invocation. Never discovers
// users to remove by listing a provider account or by an email/name search.
assert.ok(process.env.CLERK_SECRET_KEY?.startsWith("sk_test_"));
assert.ok(!process.env.CLERK_API_URL);
const path = process.argv[2];
const saved: {
  runId: string;
  origin: string;
  users: { id: string; username: string }[];
  trips: string[];
  cleaned?: boolean;
  sourceDeletedAt?: string;
} = JSON.parse(await readFile(path, "utf8"));
assert.match(saved.runId, /^nmt22_[a-f0-9]{12}$/);
const origin = new URL(saved.origin);
assert.ok(
  origin.protocol === "https:" ||
    (origin.protocol === "http:" && origin.hostname === "127.0.0.1"),
);
assert.equal(
  origin.origin,
  process.argv[3],
  "Confirm the inventory's exact API origin as the second argument.",
);
assert.ok(Array.isArray(saved.users) && saved.users.length <= 3);
assert.ok(Array.isArray(saved.trips) && saved.trips.length <= 1);
for (const user of saved.users) {
  assert.match(user.id, /^user_[A-Za-z0-9]+$/);
  assert.ok(user.username.startsWith(saved.runId + "_"));
}
for (const trip of saved.trips) assert.match(trip, /^[a-f0-9-]{36}$/);
const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});
const sessions: string[] = [];
for (const user of saved.users) {
  const current = await clerk.users.getUser(user.id);
  assert.equal(current.privateMetadata.nmtReleaseCheck, saved.runId);
  sessions.push((await clerk.sessions.createSession({ userId: user.id })).id);
}
async function request(
  session: string,
  route: string,
  method: string,
  body?: unknown,
  status = 200,
) {
  const token = (await clerk.sessions.getToken(session)).jwt;
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
    `Task-owned cleanup ${method} ${route} failed`,
  );
  return response.json();
}
for (const id of saved.trips) {
  const route = `/api/trips/${id}`;
  if (saved.sourceDeletedAt) {
    assert.ok(!Number.isNaN(Date.parse(saved.sourceDeletedAt)));
    await request(sessions[0], route, "GET", undefined, 404);
    continue;
  }
  const trip = tripResponse.parse(await request(sessions[0], route, "GET"));
  assert.equal(trip.trip.name, saved.runId);
  await request(sessions[0], route, "DELETE", {
    confirmation: "Delete trip",
    requestId: randomUUID(),
  });
}
for (const session of sessions) {
  await request(session, "/api/me/removal", "POST", {
    confirmation: "Remove my account",
    requestId: randomUUID(),
  });
}
saved.cleaned = true;
await writeFile(path, JSON.stringify(saved, null, 2) + "\n");
console.log(
  `Removed only the exact marked development identities/trip in ${saved.runId}; no object deletion requested.`,
);
