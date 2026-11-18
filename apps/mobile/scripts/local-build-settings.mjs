import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, parseEnv } from "node:util";

export const mobileBuildVariables = [
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID",
  "GOOGLE_SERVICES_JSON",
];

export function localBuildSettings(args, app, inherited = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      profile: { type: "string", default: "preview" },
      "prepare-only": { type: "boolean", default: false },
      offline: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  assert.ok(
    values.profile === "preview" || values.profile === "production",
    "Use --profile preview or --profile production for a standalone local APK.",
  );
  const profile = values.profile;
  const eas = JSON.parse(readFileSync(join(app, "eas.json"), "utf8"));
  const build = eas.build[profile];
  assert.ok(
    build.environment === profile && build.channel === profile,
    "The selected EAS profile must use its own environment and update channel.",
  );
  const files =
    profile === "production"
      ? [".env.production", ".env.production.local"]
      : [".env", ".env.local"];
  const settings = Object.fromEntries(
    mobileBuildVariables
      .filter((name) => typeof inherited[name] === "string")
      .map((name) => [name, inherited[name]]),
  );
  for (const name of files) {
    const file = join(app, name);
    if (!existsSync(file)) continue;
    const parsed = parseEnv(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    for (const key of mobileBuildVariables)
      if (Object.hasOwn(parsed, key)) settings[key] = parsed[key];
  }
  return {
    profile,
    channel: build.channel,
    settings,
    prepareOnly: values["prepare-only"],
    offline: values.offline,
  };
}
