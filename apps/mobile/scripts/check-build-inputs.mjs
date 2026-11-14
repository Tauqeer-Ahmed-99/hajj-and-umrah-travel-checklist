import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// EAS invokes this after dependencies are installed. These checks belong only
// to the app producing the binary; API builds and tests need no mobile values.
const api = new URL(process.env.EXPO_PUBLIC_API_URL ?? "");
assert.ok(
  api.protocol === "https:" &&
    !api.username &&
    !api.password &&
    api.pathname === "/" &&
    !api.search &&
    !api.hash,
  "Set this build's EXPO_PUBLIC_API_URL to the intended HTTPS API origin.",
);
const key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
assert.match(
  key ?? "",
  /^pk_(test|live)_[A-Za-z0-9_-]+$/,
  "Set this build's public Clerk instance key.",
);
const google = process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID;
if (google)
  assert.match(
    google,
    /^25995067202-[a-z0-9]+\.apps\.googleusercontent\.com$/,
    "Use the NMT Travel project's public Web OAuth client ID.",
  );
const file = process.env.GOOGLE_SERVICES_JSON;
if (file) {
  const config = JSON.parse(await readFile(file, "utf8"));
  assert.equal(
    config.project_info?.project_id,
    "nmt-travel",
    "Wrong Firebase project.",
  );
  assert.ok(
    config.client?.some(
      (client) =>
        client.client_info?.android_client_info?.package_name ===
        "in.nmtsolutions.travel",
    ),
    "Firebase file must contain this Android application.",
  );
}
const project = JSON.parse(
  await readFile(new URL("../eas-project.json", import.meta.url), "utf8"),
);
assert.equal(project.projectId, "8c2739c3-9d23-4c92-a50a-836d3ea3a94c");
console.log(
  JSON.stringify({
    check: "native-build-inputs",
    api: api.origin,
    clerk: key.startsWith("pk_live_") ? "production" : "development",
    google: Boolean(google),
    firebaseAndroidConfig: Boolean(file),
    notice:
      "Input validation is not provider, signed-artifact or device acceptance.",
  }),
);
