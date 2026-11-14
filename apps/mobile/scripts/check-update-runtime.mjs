import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const expected = process.argv[2];
assert.match(
  expected ?? "",
  /^[a-f0-9]{40}$/,
  "Pass the inspected installed APK's runtime fingerprint.",
);
assert.ok(
  !process.env.EXPO_UPDATES_FINGERPRINT_OVERRIDE,
  "Resolve the actual native inputs without a fingerprint override.",
);
const require = createRequire(import.meta.url);
const cli = join(
  dirname(require.resolve("expo-updates/package.json")),
  "bin/cli.js",
);
const result = spawnSync(
  process.execPath,
  [cli, "runtimeversion:resolve", "--platform", "android"],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);
assert.equal(
  result.status,
  0,
  "Could not resolve the current Expo native runtime.",
);
const resolved = JSON.parse(result.stdout);
assert.equal(
  resolved.runtimeVersion,
  expected,
  "Native inputs differ from the inspected APK. Build another signed APK; do not label this a compatible update.",
);
console.log(
  JSON.stringify({
    check: "compatible-preview-runtime",
    runtime: resolved.runtimeVersion,
  }),
);
