import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  statfsSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(app, "../..");
const args = process.argv.slice(2);
assert.ok(
  args.every((arg) => ["--prepare-only", "--offline"].includes(arg)),
  "Options: --prepare-only, --offline",
);
const prepareOnly = args.includes("--prepare-only");
const state = join(root, ".local/android-local-build");
mkdirSync(state, { recursive: true });
const credentialsFile = join(app, "credentials.json");
assert.ok(
  existsSync(credentialsFile),
  "Download the existing Android credentials with eas credentials; see docs/local-android-build.md.",
);
function readCredentials() {
  try {
    return JSON.parse(readFileSync(credentialsFile, "utf8")).android?.keystore;
  } catch {
    throw new Error("Could not read valid Android credentials.json.");
  }
}
const key = readCredentials();
assert.ok(
  key?.keystorePath && key.keystorePassword && key.keyAlias && key.keyPassword,
  "Incomplete Android credentials.json.",
);
const keystore = resolve(app, key.keystorePath);
assert.ok(
  existsSync(keystore),
  "The configured Android keystore file is missing.",
);
const sensitive = [key.keystorePassword, key.keyPassword];
const redact = (text) =>
  sensitive.reduce(
    (output, secret) => output.split(secret).join("[redacted]"),
    text,
  );
const expectedCertificate =
  "f6e8630d6745ac7920f15c8bdea855f90880e4e12953645f92a9a1979298ced5";
const settings = Object.assign(
  {},
  ...[".env", ".env.local"]
    .filter((name) => existsSync(join(app, name)))
    .map((name) =>
      parseEnv(readFileSync(join(app, name), "utf8").replace(/^\uFEFF/, "")),
    ),
);
const env = {
  ...process.env,
  CI: "1",
  NODE_ENV: "production",
  EAS_BUILD_PROFILE: "preview",
  EXPO_NO_TELEMETRY: "1",
  EXPO_NO_DOTENV: "1",
  CMAKE_BUILD_PARALLEL_LEVEL: "2",
};
for (const name of [
  "DATABASE_URL",
  "CLERK_SECRET_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "EXPO_ACCESS_TOKEN",
  "CRON_SECRET",
])
  delete env[name];
for (const name of [
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID",
  "GOOGLE_SERVICES_JSON",
]) {
  if (settings[name]) env[name] = settings[name];
}
assert.ok(
  env.GOOGLE_SERVICES_JSON && existsSync(env.GOOGLE_SERVICES_JSON),
  "Set the existing GOOGLE_SERVICES_JSON file path in apps/mobile/.env.local.",
);
const java = env.JAVA_HOME
  ? join(
      env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "java.exe" : "java",
    )
  : "java";
const keytool = env.JAVA_HOME
  ? join(
      env.JAVA_HOME,
      "bin",
      process.platform === "win32" ? "keytool.exe" : "keytool",
    )
  : "keytool";
async function run(label, executable, command, cwd = app, extraEnv = {}) {
  console.log(label);
  const log = join(
    state,
    label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-") + ".log",
  );
  const child = spawn(executable, command, {
    cwd,
    env: { ...env, ...extraEnv },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const append = (chunk) => {
    output += chunk.toString();
    writeFileSync(log, redact(output));
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const code = await new Promise((done, reject) => {
    child.on("error", reject);
    child.on("exit", done);
  });
  assert.equal(code, 0, `${label} failed; inspect ${log}`);
  return output;
}

try {
  const certificate = await run(
    "Verify existing signing certificate",
    keytool,
    [
      "-list",
      "-rfc",
      "-keystore",
      keystore,
      "-alias",
      key.keyAlias,
      "-storepass:env",
      "TC_LOCAL_KEYSTORE_PASSWORD",
    ],
    app,
    { TC_LOCAL_KEYSTORE_PASSWORD: key.keystorePassword },
  );
  const pem = certificate.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/,
  );
  assert.ok(pem, "Signing certificate could not be read.");
  assert.equal(
    new X509Certificate(pem[0]).fingerprint256
      .replaceAll(":", "")
      .toLowerCase(),
    expectedCertificate,
    "Signing key differs from the installed preview; no APK was built.",
  );
  const compiler = join(
    root,
    "node_modules/hermes-compiler/hermesc",
    process.platform === "win32"
      ? "win64-bin/hermesc.exe"
      : process.platform === "darwin"
        ? "osx-bin/hermesc"
        : "linux64-bin/hermesc",
  );
  const smoke = join(state, "compiler-smoke.js");
  const bytecode = join(state, "compiler-smoke.hbc");
  writeFileSync(smoke, "globalThis.travelCompanionLocalBuild = true;\n");
  await run("Verify Hermes compilation", compiler, [
    "-O",
    "-emit-binary",
    "-out",
    bytecode,
    smoke,
  ]);
  assert.equal(
    readFileSync(bytecode).subarray(0, 8).toString("hex"),
    "c61fbc03c103191f",
  );
  await run("Check native build inputs", process.execPath, [
    "scripts/check-build-inputs.mjs",
  ]);
  await run("Check authentication configuration", process.execPath, [
    "scripts/check-auth-provider.mjs",
  ]);
  await run("Generate Android project", process.execPath, [
    join(root, "node_modules/expo/bin/cli"),
    "prebuild",
    "--platform",
    "android",
    "--no-install",
  ]);
  const manifest = readFileSync(
    join(app, "android/app/src/main/AndroidManifest.xml"),
    "utf8",
  );
  assert.ok(
    manifest.includes("expo-channel-name") && manifest.includes("preview"),
    "The local preview update channel was not configured.",
  );
  const runtimeOutput = await run("Resolve native runtime", process.execPath, [
    join(root, "node_modules/expo-updates/bin/cli.js"),
    "runtimeversion:resolve",
    "--platform",
    "android",
  ]);
  const runtime = JSON.parse(
    runtimeOutput.slice(runtimeOutput.indexOf("{")),
  ).runtimeVersion;
  assert.match(runtime, /^[a-f0-9]{40}$/);
  const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
  assert.ok(
    sdk && existsSync(sdk),
    "Set ANDROID_HOME to your installed Android SDK.",
  );
  const config = JSON.parse(
    (
      await run("Resolve Expo configuration", process.execPath, [
        join(root, "node_modules/expo/bin/cli"),
        "config",
        "--json",
      ])
    ).trim(),
  );
  const version = config.android.versionCode;
  const sourceCommit = (
    await run("Record build source", "git", ["rev-parse", "HEAD"], root)
  ).trim();
  const sourceDirty = Boolean(
    (
      await run(
        "Check working tree",
        "git",
        ["status", "--porcelain", "--untracked-files=no"],
        root,
      )
    ).trim(),
  );
  const report = {
    package: config.android.package,
    version: config.version,
    versionCode: version,
    channel: "preview",
    runtime,
    certificateSha256: expectedCertificate,
    architectures: ["arm64-v8a", "x86_64"],
    sourceCommit,
    sourceDirty,
    prepared: true,
  };
  writeFileSync(join(state, "build.json"), JSON.stringify(report, null, 2));
  if (prepareOnly) {
    console.log(`Local release preparation passed. Runtime: ${runtime}`);
  } else {
    const space = statfsSync(root);
    const cachedRelease = existsSync(
      join(app, "android/app/build/outputs/apk/release/app-release.apk"),
    );
    const minimumFreeGiB = cachedRelease ? 4 : 8;
    assert.ok(
      space.bavail * space.bsize > minimumFreeGiB * 1024 ** 3,
      `At least ${minimumFreeGiB} GiB of free workspace disk space is required for this local native build.`,
    );
    const gradle = [
      "-classpath",
      join(app, "android/gradle/wrapper/gradle-wrapper.jar"),
      "org.gradle.wrapper.GradleWrapperMain",
      ":app:assembleRelease",
      "--console=plain",
      "--max-workers=2",
      // Windows retains dependency JAR handles in a reused build JVM.
      "--no-daemon",
      "-Pkotlin.compiler.execution.strategy=in-process",
      "-Dorg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m",
      "-PreactNativeArchitectures=arm64-v8a,x86_64",
      `-PtravelCompanionCredentialsFile=${credentialsFile}`,
      "-I",
      join(app, "scripts/local-release-signing.gradle"),
    ];
    if (process.platform === "win32")
      gradle.push("-I", join(app, "scripts/windows-cmake.gradle"));
    if (args.includes("--offline")) gradle.push("--offline");
    await run("Build signed release APK", java, gradle, join(app, "android"));
    const apk = join(
      app,
      "android/app/build/outputs/apk/release/app-release.apk",
    );
    assert.ok(existsSync(apk), "Release APK was not produced.");
    const toolsVersion = readdirSync(join(sdk, "build-tools"))
      .filter((name) => /^\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    assert.ok(toolsVersion, "Install an Android SDK build-tools release.");
    await run(
      "Inspect signed release artifact",
      process.platform === "win32" ? "python" : "python3",
      [
        join(root, "scripts/inspect-apk.py"),
        apk,
        "--build-tools",
        join(sdk, "build-tools", toolsVersion),
        "--channel",
        "preview",
        "--runtime",
        runtime,
        "--api",
        env.EXPO_PUBLIC_API_URL,
        "--clerk-key",
        env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
        "--secret-file",
        credentialsFile,
        "--output",
        join(state, "artifact-inspection.json"),
      ],
    );
    const destination = join(
      root,
      ".local",
      `travel-companion-local-v${version}.apk`,
    );
    copyFileSync(apk, destination);
    report.apk = destination;
    report.sha256 = createHash("sha256")
      .update(readFileSync(destination))
      .digest("hex");
    report.built = true;
    writeFileSync(join(state, "build.json"), JSON.stringify(report, null, 2));
    console.log(`Signed APK: ${destination}\nSHA256: ${report.sha256}`);
  }
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}
