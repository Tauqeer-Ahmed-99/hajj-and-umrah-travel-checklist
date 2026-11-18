import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = new URL("../scripts/check-build-inputs.mjs", import.meta.url);
const publicKey = (mode) =>
  `pk_${mode}_${Buffer.from("clerk.example.com$").toString("base64").replace(/=+$/, "")}`;
const base = {
  ...process.env,
  EXPO_PUBLIC_API_URL: "https://api.example.com",
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: publicKey("live"),
  EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID:
    "25995067202-example.apps.googleusercontent.com",
  GOOGLE_SERVICES_JSON: "",
  EAS_BUILD_PROFILE: "production",
};
const run = (values = {}) =>
  spawnSync(process.execPath, [fileURLToPath(script)], {
    env: { ...base, ...values },
    encoding: "utf8",
    windowsHide: true,
  });

test("production refuses development authentication before building", () => {
  const result = run({ EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: publicKey("test") });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /production publishable key/);
});

test("production requires the Google client and Firebase Android config", () => {
  const google = run({ EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: "" });
  assert.notEqual(google.status, 0);
  assert.match(google.stderr, /Google Web OAuth client ID/);
  const firebase = run();
  assert.notEqual(firebase.status, 0);
  assert.match(firebase.stderr, /Firebase Android client file/);
});

test("production accepts the intended app's native inputs and rejects another package", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-build-inputs-"));
  const file = join(directory, "google-services.json");
  const write = (packageName) =>
    writeFileSync(
      file,
      JSON.stringify({
        project_info: { project_id: "nmt-travel" },
        client: [
          {
            client_info: {
              android_client_info: { package_name: packageName },
            },
          },
        ],
      }),
    );
  try {
    write("in.nmtsolutions.travel");
    const accepted = run({ GOOGLE_SERVICES_JSON: file });
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).clerk, "production");
    write("com.example.other");
    const rejected = run({ GOOGLE_SERVICES_JSON: file });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /this Android application/);
  } finally {
    rmSync(file);
    rmdirSync(directory);
  }
});

test("preview retains development keys and optional Google/Firebase configuration", () => {
  const result = run({
    EAS_BUILD_PROFILE: "preview",
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: publicKey("test"),
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: "",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).clerk, "development");
});
