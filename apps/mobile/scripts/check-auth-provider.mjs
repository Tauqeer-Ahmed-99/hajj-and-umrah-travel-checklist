import assert from "node:assert/strict";

// An explicit release preflight against Clerk's public application settings.
// It needs only the same public key consumed by the Android app.
const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
assert.match(
  key ?? "",
  /^pk_(test|live)_[A-Za-z0-9_-]+$/,
  "Supply the mobile build's public Clerk key.",
);
const frontend = Buffer.from(key.replace(/^pk_(test|live)_/, ""), "base64")
  .toString("utf8")
  .replace(/\$$/, "");
const origin = new URL(`https://${frontend}`);
assert.ok(
  origin.hostname === frontend && !origin.username && !origin.password,
  "Invalid Clerk frontend host.",
);
const response = await fetch(new URL("/v1/environment", origin), {
  signal: AbortSignal.timeout(20_000),
});
assert.ok(response.ok, "Could not check the selected Clerk application.");
const payload = await response.json();
const settings = payload.response ?? payload;
assert.equal(
  settings.auth_config?.native_settings?.api_enabled,
  true,
  "Enable Clerk Native API for this build's application.",
);
assert.equal(
  settings.user_settings?.attributes?.password?.required,
  false,
  "This app uses passwordless email codes. Disable required passwords in the selected Clerk application.",
);
assert.ok(
  settings.auth_config?.first_factors?.includes("email_code"),
  "Enable email-code sign-in in the selected Clerk application.",
);
assert.equal(
  settings.user_settings?.attributes?.email_address?.required,
  true,
  "A verified email is required by the account API.",
);
assert.ok(
  settings.auth_config?.first_factors?.includes("google_one_tap"),
  "Enable Google with custom Web credentials in the selected Clerk application. oauth_google alone does not enable the native strategy.",
);
console.log(
  "Clerk public configuration passed: passwordless email, native API, native Google. Real identity/device verification remains separate.",
);
