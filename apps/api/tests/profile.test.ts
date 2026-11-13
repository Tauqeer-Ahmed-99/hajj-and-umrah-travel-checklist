import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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

test("Google profile suggestions remain unsaved until missing fields are completed", async () => {
  const token = await fixture.token(
    "user_google_draft",
    "google@example.test",
    {
      strategy: "google_one_tap",
      profile: { firstName: "  Amina  " },
    },
  );
  const initial = await fixture.request("/api/me", token);
  assert.equal(initial.status, 200, fixture.logs());
  assert.deepEqual(initial.data, {
    profile: null,
    email: "google@example.test",
    profileDefaults: { firstName: "Amina" },
  });
  const incomplete = await fixture.request("/api/me", token, {
    firstName: "Amina",
    lastName: "",
    username: "amina_google",
  });
  assert.equal(incomplete.status, 422);
  assert.ok(incomplete.data.error.fields.lastName);
  assert.equal((await fixture.request("/api/me", token)).data.profile, null);
  const saved = await fixture.request("/api/me", token, {
    firstName: "Aminah",
    lastName: "Khan",
    username: "amina_google",
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.profile.firstName, "Aminah");
  const restored = await fixture.request("/api/me", token);
  assert.deepEqual(restored.data, saved.data);
  assert.equal(restored.data.profileDefaults, undefined);
});

test("verified Google names fill absent Clerk names without using unverified provider data", async () => {
  for (const verified of [true, false]) {
    const token = await fixture.token(
      `user_google_names_${verified}`,
      "names@example.test",
      {
        profile: { firstName: "Chosen", username: "bad-handle" },
        googleProfile: {
          firstName: "Provider",
          lastName: "  Khan  ",
          verified,
        },
      },
    );
    const response = await fixture.request("/api/me", token);
    assert.equal(response.status, 200, fixture.logs());
    assert.deepEqual(response.data, {
      profile: null,
      email: "names@example.test",
      profileDefaults: verified
        ? { firstName: "Chosen", lastName: "Khan" }
        : { firstName: "Chosen" },
    });
  }
});

test("a verified member can complete a profile and retrieve it after an API restart", async () => {
  const token = await fixture.token("user_persistence", "sana@example.test");
  const initial = await fixture.request("/api/me", token);
  assert.equal(initial.status, 200, fixture.logs());
  assert.deepEqual(initial.data, { profile: null, email: "sana@example.test" });
  const saved = await fixture.request("/api/me", token, {
    firstName: "Sana",
    lastName: "Ahmed",
    username: "Sana_Travel",
  });
  assert.equal(saved.status, 200);
  assert.match(saved.data.profile.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    { ...saved.data.profile, id: "stable" },
    {
      id: "stable",
      firstName: "Sana",
      lastName: "Ahmed",
      username: "sana_travel",
    },
  );
  assert.equal(saved.data.email, "sana@example.test");
  await fixture.restartApi();
  const restored = await fixture.request("/api/me", token);
  assert.deepEqual(restored.data, saved.data);
});

test("simultaneous case variants reserve a username for exactly one member", async () => {
  const first = await fixture.token("user_race_a", "a@example.test");
  const second = await fixture.token("user_race_b", "b@example.test");
  const outcomes = await Promise.all([
    fixture.request("/api/me", first, {
      firstName: "Amina",
      lastName: "Khan",
      username: "Family_One",
    }),
    fixture.request("/api/me", second, {
      firstName: "Yusuf",
      lastName: "Khan",
      username: "FAMILY_ONE",
    }),
  ]);
  assert.deepEqual(outcomes.map((result) => result.status).sort(), [200, 409]);
  const rejected = outcomes.find((result) => result.status === 409)!;
  assert.equal(rejected.data.error.code, "username_taken");
  const loser = outcomes[0].status === 409 ? first : second;
  assert.equal((await fixture.request("/api/me", loser)).data.profile, null);
  assert.equal(
    (
      await fixture.request("/api/me", loser, {
        firstName: "Family",
        lastName: "Member",
        username: "another_handle",
      })
    ).status,
    200,
  );
});

test("invalid or incomplete profile input returns field errors without saving a profile", async () => {
  const token = await fixture.token(
    "user_validation",
    "validation@example.test",
  );
  for (const username of [
    "abc",
    "a".repeat(31),
    "bad-handle",
    "name space",
    "عمر123",
  ]) {
    const invalid = await fixture.request("/api/me", token, {
      firstName: "  ",
      lastName: "",
      username,
    });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.data.error.code, "invalid_profile");
    assert.ok(invalid.data.error.fields.firstName);
    assert.ok(invalid.data.error.fields.lastName);
    assert.ok(invalid.data.error.fields.username);
  }
  assert.equal(
    (await fixture.request("/api/me", token, { username: "valid_name" }))
      .status,
    422,
  );
  const malformed = await fetch(`${fixture.url}/api/me`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await fixture.request("/api/me", token)).data.profile, null);
});

test("profile retries keep one stable member and cannot rename its username", async () => {
  const token = await fixture.token("user_retry", "retry@example.test");
  const body = {
    firstName: "  Mariam  ",
    lastName: "Ali",
    username: "MARIAM_ALI",
  };
  const saved = await fixture.request("/api/me", token, body);
  const retried = await fixture.request("/api/me", token, body);
  assert.deepEqual(retried.data, saved.data);
  const rename = await fixture.request("/api/me", token, {
    ...body,
    username: "renamed_user",
  });
  assert.equal(rename.status, 409);
  assert.equal(rename.data.error.code, "username_locked");
  const restored = await fixture.request("/api/me", token);
  assert.deepEqual(restored.data, saved.data);
  assert.equal(restored.data.profile.firstName, "Mariam");
});

test("identity and private email come only from the verified session, with no member directory", async () => {
  const owner = await fixture.token("user_owner", "private@example.test");
  const other = await fixture.token("user_other", "other@example.test");
  const saved = await fixture.request("/api/me", owner, {
    firstName: "عمر",
    lastName: "Ahmed",
    username: "owner_handle",
  });
  assert.equal(saved.status, 200);
  const attempt = await fixture.request("/api/me", other, {
    firstName: "Other",
    lastName: "Member",
    username: "other_handle",
    clerkUserId: "user_owner",
    email: "private@example.test",
    id: saved.data.profile.id,
  });
  assert.equal(attempt.status, 422);
  const isolated = await fixture.request(
    `/api/me?memberId=${saved.data.profile.id}&email=private@example.test`,
    other,
  );
  assert.deepEqual(isolated.data, {
    profile: null,
    email: "other@example.test",
  });
  assert.equal(
    (await fixture.request(`/api/members/${saved.data.profile.id}`, other))
      .status,
    404,
  );
  const restored = await fixture.request("/api/me", owner);
  assert.deepEqual(restored.data, saved.data);
  assert.equal(restored.headers.get("cache-control"), "private, no-store");
  assert.ok(
    restored.headers
      .get("vary")
      ?.toLowerCase()
      .split(/,\s*/)
      .includes("authorization"),
  );
  assert.deepEqual(Object.keys(restored.data.profile).sort(), [
    "firstName",
    "id",
    "lastName",
    "username",
  ]);
});

for (const firstStrategy of ["google_one_tap", "email_code"] as const) {
  test(`${firstStrategy}-first and the linked sign-in method retain the saved member`, async () => {
    // Provider fixtures describe an already linked Clerk identity. They do not
    // implement or prove Clerk's actual OAuth/email linking policy.
    const id = `user_linked_${firstStrategy}`;
    const email = `${firstStrategy}@example.test`;
    const firstSessionId = `sess_first_${firstStrategy}`;
    const first = await fixture.token(id, email, {
      sessionId: firstSessionId,
      strategy: firstStrategy,
      profile: { firstName: "Google", lastName: "Suggestion" },
    });
    const saved = await fixture.request("/api/me", first, {
      firstName: "Ali",
      lastName: "Khan",
      username: `linked_${firstStrategy}`,
    });
    assert.equal(saved.status, 200);
    fixture.revoke(firstSessionId);
    const linked = await fixture.token(id, email, {
      sessionId: `sess_second_${firstStrategy}`,
      strategy:
        firstStrategy === "email_code" ? "google_one_tap" : "email_code",
      profile: {
        firstName: "Changed",
        lastName: "Provider",
        username: "different_hint",
      },
    });
    const restored = await fixture.request("/api/me", linked);
    assert.equal(restored.status, 200);
    assert.deepEqual(restored.data, saved.data);
    assert.deepEqual(Object.keys(restored.data.profile).sort(), [
      "firstName",
      "id",
      "lastName",
      "username",
    ]);
    // A matching email from a different subject must never be linked by the app.
    const unrelated = await fixture.token(`different_${id}`, email);
    const isolated = await fixture.request(
      `/api/me?memberId=${saved.data.profile.id}`,
      unrelated,
    );
    assert.equal(isolated.status, 200);
    assert.equal(isolated.data.profile, null);
    const collision = await fixture.request("/api/me", unrelated, {
      firstName: "Other",
      lastName: "Person",
      username: saved.data.profile.username,
    });
    assert.equal(collision.status, 409);
    assert.deepEqual(
      (await fixture.request("/api/me", linked)).data,
      saved.data,
    );
  });
}

test("missing, forged, expired, wrong-issuer, wrong-origin and revoked sessions cannot read or write profiles", async () => {
  const token = await fixture.token("user_invalid", "invalid@example.test");
  const revoked = await fixture.token("user_revoked", "revoked@example.test");
  fixture.revoke("sess_user_revoked");
  const signatureParts = token.split(".");
  signatureParts[2] = `${signatureParts[2][0] === "a" ? "b" : "a"}${signatureParts[2].slice(1)}`;
  const invalidTokens = [
    undefined,
    "not-a-token",
    signatureParts.join("."),
    await fixture.token("user_expired", "expired@example.test", {
      expired: true,
    }),
    await fixture.token("user_issuer", "issuer@example.test", {
      issuer: "https://other.clerk.accounts.dev",
    }),
    await fixture.token("user_origin", "origin@example.test", {
      azp: "https://untrusted.example",
    }),
    revoked,
  ];
  for (const invalid of invalidTokens) {
    for (const body of [
      undefined,
      { firstName: "Invalid", lastName: "Member", username: "invalid_member" },
    ]) {
      const response = await fixture.request("/api/me", invalid, body);
      assert.equal(response.status, 401);
      assert.equal(response.data.error.code, "invalid_session");
      assert.ok(!JSON.stringify(response.data).includes("@example.test"));
    }
  }
  const impersonation = await fetch(`${fixture.url}/api/me`, {
    headers: { "X-User-Id": "user_owner", Cookie: `__session=${token}` },
  });
  assert.equal(impersonation.status, 401);
});

test("an unverified primary email cannot complete a profile", async () => {
  const token = await fixture.token(
    "user_unverified",
    "unverified@example.test",
    { verified: false },
  );
  const response = await fixture.request("/api/me", token, {
    firstName: "Unverified",
    lastName: "Member",
    username: "unverified_member",
  });
  assert.equal(response.status, 403);
  assert.equal(response.data.error.code, "email_unverified");
});

test("an identity-provider outage returns a retryable error without changing a saved profile", async () => {
  const token = await fixture.token("user_outage", "outage@example.test");
  const saved = await fixture.request("/api/me", token, {
    firstName: "Before",
    lastName: "Outage",
    username: "outage_member",
  });
  fixture.providerAvailable(false);
  try {
    const response = await fixture.request("/api/me", token, {
      firstName: "After",
      lastName: "Outage",
      username: "outage_member",
    });
    assert.equal(response.status, 503);
    assert.equal(response.data.error.code, "identity_unavailable");
  } finally {
    fixture.providerAvailable(true);
  }
  assert.deepEqual((await fixture.request("/api/me", token)).data, saved.data);
});

test("profile writes reject unsupported media and oversized streamed input", async () => {
  const token = await fixture.token("user_input_limits", "limits@example.test");
  const unsupported = await fetch(`${fixture.url}/api/me`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: "{}",
  });
  assert.equal(unsupported.status, 415);
  const oversized = await fixture.request("/api/me", token, {
    firstName: "a".repeat(9000),
    lastName: "Member",
    username: "input_limits",
  });
  assert.equal(oversized.status, 413);
  assert.equal((await fixture.request("/api/me", token)).data.profile, null);
});

test("a cold-start identity key outage is retryable rather than signing the member out", async () => {
  const token = await fixture.token("user_cold_outage", "cold@example.test");
  await fixture.restartApi();
  fixture.providerAvailable(false);
  try {
    const response = await fixture.request("/api/me", token);
    assert.equal(response.status, 503, fixture.logs());
    assert.equal(response.data.error.code, "identity_unavailable");
  } finally {
    fixture.providerAvailable(true);
  }
  assert.equal((await fixture.request("/api/me", token)).status, 200);
});
