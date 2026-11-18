import assert from "node:assert/strict";
import {
  mkdtempSync,
  readdirSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localBuildSettings } from "../scripts/local-build-settings.mjs";

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "travel-local-settings-"));
  writeFileSync(
    join(directory, "eas.json"),
    JSON.stringify({
      build: {
        preview: { environment: "preview", channel: "preview" },
        production: { environment: "production", channel: "production" },
      },
    }),
  );
  const write = (name, content) =>
    writeFileSync(join(directory, name), content);
  try {
    run(directory, write);
  } finally {
    for (const name of readdirSync(directory)) rmSync(join(directory, name));
    rmdirSync(directory);
  }
}

test("production cannot load a preview dotenv file or its API credentials", () => {
  fixture((directory, write) => {
    write(".env", "EXPO_PUBLIC_API_URL=https://preview.example.com\n");
    write(".env.local", "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=preview-key\n");
    write(
      ".env.production.local",
      "EXPO_PUBLIC_API_URL=https://production.example.com\nCLERK_SECRET_KEY=server-only\nDATABASE_URL=server-only\n",
    );
    const result = localBuildSettings(
      ["--profile", "production"],
      directory,
      {},
    );
    assert.equal(result.profile, "production");
    assert.equal(result.channel, "production");
    assert.deepEqual(result.settings, {
      EXPO_PUBLIC_API_URL: "https://production.example.com",
    });
  });
});

test("the default preview command preserves local overrides without selecting production values", () => {
  fixture((directory, write) => {
    write(".env", "EXPO_PUBLIC_API_URL=https://base.example.com\n");
    write(".env.local", "EXPO_PUBLIC_API_URL=https://preview.example.com\n");
    write(
      ".env.production.local",
      "EXPO_PUBLIC_API_URL=https://production.example.com\n",
    );
    const result = localBuildSettings([], directory, {});
    assert.equal(result.profile, "preview");
    assert.equal(result.channel, "preview");
    assert.equal(
      result.settings.EXPO_PUBLIC_API_URL,
      "https://preview.example.com",
    );
  });
});

test("an explicitly blank production value cannot fall back to an inherited key", () => {
  fixture((directory, write) => {
    write(".env.production.local", "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=\n");
    const result = localBuildSettings(
      ["--profile", "production", "--prepare-only", "--offline"],
      directory,
      {
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "inherited-key",
        CLERK_SECRET_KEY: "server-only",
      },
    );
    assert.equal(result.settings.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, "");
    assert.ok(!Object.hasOwn(result.settings, "CLERK_SECRET_KEY"));
    assert.equal(result.prepareOnly, true);
    assert.equal(result.offline, true);
  });
});

test("unsupported profiles and misspelled arguments stop before any native build", () => {
  fixture((directory) => {
    assert.throws(
      () => localBuildSettings(["--profile", "development"], directory, {}),
      /standalone local APK/,
    );
    assert.throws(
      () => localBuildSettings(["--production"], directory, {}),
      /Unknown option/,
    );
  });
});
